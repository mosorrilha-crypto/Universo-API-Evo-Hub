/**
 * Financeiro operacional — navegação contextual e formulários sob demanda.
 * A área exibe apenas a rotina escolhida para evitar uma pilha longa de
 * cadastros; dados e ações continuam protegidos pelo entitlement financeiro.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Landmark,
  PackageCheck,
  Plus,
  RefreshCw,
  ShoppingCart,
  Tags,
  WalletCards,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type Category = { id: string; name: string; kind: 'income' | 'expense' | 'cost'; active: boolean };
type Account = { id: string; name: string; accountType: 'cash' | 'bank' | 'digital_wallet' | 'card'; openingBalance: number; active: boolean };
type InventoryItem = { id: string; name: string; sku?: string; itemType: 'product' | 'supply'; unit: string; onHandQuantity: number; reorderPoint: number; averageUnitCost: number; active: boolean };
type Purchase = { id: string; supplierName: string; status: 'draft' | 'receiving' | 'received' | 'cancelled'; paymentMethod: string; totalAmount: number; receivedAt?: string };
type FinancialTitle = { id: string; direction: 'payable' | 'receivable'; status: 'open' | 'overdue' | 'partial' | 'settled' | 'cancelled'; description: string; counterpartyName: string; originalAmount: number; openAmount: number; dueDate: string; paymentMethod?: string; categoryId?: string };

export type FinancialOperationsSection = 'titles' | 'purchases' | 'inventory' | 'structure';
type StructureSection = 'categories' | 'accounts';
type TitleFilter = 'all' | 'payable' | 'receivable' | 'overdue';

interface FinancialOperationsCenterProps {
  currency: string;
  locale: string;
  onToast: (message: string) => void;
  activeSection?: FinancialOperationsSection;
  onNavigateToSection?: (section: FinancialOperationsSection) => void;
}

const formatMoney = (value: number, currency: string, locale: string) => new Intl.NumberFormat(locale || 'pt-BR', { style: 'currency', currency: currency || 'BRL', maximumFractionDigits: currency === 'PYG' ? 0 : 2 }).format(value || 0);
const categoryLabel: Record<Category['kind'], string> = { income: 'Receita', expense: 'Despesa', cost: 'Custo' };
const accountLabel: Record<Account['accountType'], string> = { cash: 'Caixa', bank: 'Banco', digital_wallet: 'Carteira digital', card: 'Cartão' };

function titleStatusLabel(status: FinancialTitle['status']) {
  return ({ open: 'Em aberto', overdue: 'Vencido', partial: 'Parcial', settled: 'Liquidado', cancelled: 'Cancelado' } as const)[status];
}

export function FinancialOperationsCenter({ currency, locale, onToast, activeSection = 'titles', onNavigateToSection }: FinancialOperationsCenterProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [titles, setTitles] = useState<FinancialTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState('');
  const [categoryKind, setCategoryKind] = useState<Category['kind']>('expense');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<Account['accountType']>('cash');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [itemName, setItemName] = useState('');
  const [itemSku, setItemSku] = useState('');
  const [itemType, setItemType] = useState<InventoryItem['itemType']>('supply');
  const [itemUnit, setItemUnit] = useState('un');
  const [itemReorderPoint, setItemReorderPoint] = useState('0');
  const [supplierName, setSupplierName] = useState('');
  const [purchaseItemId, setPurchaseItemId] = useState('');
  const [purchaseQuantity, setPurchaseQuantity] = useState('1');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState('0');
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState('PIX');
  const [titleDirection, setTitleDirection] = useState<FinancialTitle['direction']>('payable');
  const [titleDescription, setTitleDescription] = useState('');
  const [titleCounterparty, setTitleCounterparty] = useState('');
  const [titleAmount, setTitleAmount] = useState('0');
  const [titleDueDate, setTitleDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [titlePaymentMethod, setTitlePaymentMethod] = useState('PIX');
  const [titleCategoryId, setTitleCategoryId] = useState('');
  const [settlementAccountByTitle, setSettlementAccountByTitle] = useState<Record<string, string>>({});
  const [titleFilter, setTitleFilter] = useState<TitleFilter>('all');
  const [structureSection, setStructureSection] = useState<StructureSection>('categories');
  const [titleComposerOpen, setTitleComposerOpen] = useState(false);
  const [purchaseComposerOpen, setPurchaseComposerOpen] = useState(false);
  const [inventoryComposerOpen, setInventoryComposerOpen] = useState(false);
  const [structureComposerOpen, setStructureComposerOpen] = useState(false);
  const [titleLimit, setTitleLimit] = useState(8);
  const [purchaseLimit, setPurchaseLimit] = useState(6);
  const [itemLimit, setItemLimit] = useState(8);

  const lowStockItems = useMemo(() => items.filter((item) => item.onHandQuantity <= item.reorderPoint), [items]);
  const openTitles = useMemo(() => titles.filter((title) => !['settled', 'cancelled'].includes(title.status)), [titles]);
  const visibleTitles = useMemo(() => titles
    .filter((title) => titleFilter === 'all' || title.direction === titleFilter || (titleFilter === 'overdue' && title.status === 'overdue'))
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate)), [titleFilter, titles]);

  const navigate = (section: FinancialOperationsSection) => onNavigateToSection?.(section);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all([
        apiFetch('/api/financial/categories'),
        apiFetch('/api/financial/accounts'),
        apiFetch('/api/financial/inventory/items'),
        apiFetch('/api/financial/purchases'),
        apiFetch('/api/financial/titles'),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error('Não foi possível carregar a estrutura operacional.');
      const [categoryData, accountData, itemData, purchaseData, titleData] = await Promise.all(responses.map((response) => response.json()));
      setCategories(categoryData.categories || []);
      setAccounts(accountData.accounts || []);
      setItems(itemData.items || []);
      setPurchases(purchaseData.purchases || []);
      setTitles(titleData.titles || []);
    } catch (loadError: any) {
      setError(loadError.message || 'Não foi possível carregar a estrutura operacional.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (path: string, body: unknown, success: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
      await load();
      onToast(success);
      return result;
    } catch (submitError: any) {
      setError(submitError.message || 'Não foi possível concluir a operação.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const receivePurchase = async (purchaseId: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/financial/purchases/${purchaseId}/receive`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível receber a compra.');
      await load();
      onToast('Compra recebida: estoque e conta a pagar atualizados.');
    } catch (receiveError: any) {
      setError(receiveError.message || 'Não foi possível receber a compra.');
    } finally {
      setSaving(false);
    }
  };

  const settleTitle = async (title: FinancialTitle) => {
    const accountId = settlementAccountByTitle[title.id] || accounts.find((account) => account.active)?.id;
    if (!accountId) {
      setError('Cadastre uma conta financeira antes de baixar um título.');
      return;
    }
    const result = await submit(`/api/financial/titles/${title.id}/settlements`, { amount: title.openAmount, financialAccountId: accountId, paymentMethod: title.paymentMethod || 'PIX' }, `${title.direction === 'payable' ? 'Pagamento' : 'Recebimento'} confirmado e lançado no caixa.`);
    if (result) setSettlementAccountByTitle((current) => ({ ...current, [title.id]: accountId }));
  };

  const openTitleComposer = (direction: FinancialTitle['direction']) => {
    setTitleDirection(direction);
    setTitleComposerOpen(true);
  };

  const sectionCopy: Record<FinancialOperationsSection, { eyebrow: string; title: string; description: string }> = {
    titles: { eyebrow: 'Previsão e baixa', title: 'Contas a Pagar e Receber', description: 'Priorize vencimentos e registre o pagamento ou recebimento sem percorrer os cadastros.' },
    purchases: { eyebrow: 'Abastecimento', title: 'Compras e recebimento', description: 'Registre a compra e, ao receber, atualize estoque e conta a pagar em uma única rotina.' },
    inventory: { eyebrow: 'Controle físico', title: 'Estoque atual', description: 'Acompanhe saldo, reposição e custos dos itens cadastrados.' },
    structure: { eyebrow: 'Configuração', title: 'Categorias e contas', description: 'Mantenha a base financeira organizada sem misturar esta configuração com a operação diária.' },
  };
  const currentCopy = sectionCopy[activeSection];

  return (
    <section className="space-y-3" aria-labelledby="financial-operations-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/65 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">{currentCopy.eyebrow}</p>
          <h2 id="financial-operations-heading" className="mt-1 text-base font-bold text-white">{currentCopy.title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">{currentCopy.description}</p>
        </div>
        <button type="button" onClick={load} disabled={loading || saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}

      {activeSection === 'titles' && <>
        <section className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]" aria-label="Ações de títulos">
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Próximas ações</p><p className="mt-1 text-sm font-bold text-white">{openTitles.length} título{openTitles.length === 1 ? '' : 's'} exigem acompanhamento</p></div>
              <span className="rounded-full bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-slate-400">{titles.filter((title) => title.status === 'overdue').length} vencido{titles.filter((title) => title.status === 'overdue').length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => openTitleComposer('payable')} className="group flex items-center gap-2 rounded-xl bg-slate-950/55 px-3 py-2.5 text-left transition hover:bg-violet-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"><span className="rounded-lg bg-violet-500/10 p-1.5 text-violet-200"><ArrowUpFromLine className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-xs font-bold text-slate-100">Nova conta a pagar</span><span className="block text-[10px] text-slate-500">Fornecedor, vencimento e valor</span></span><ChevronRight className="ml-auto h-4 w-4 text-slate-600 group-hover:text-violet-200" /></button>
              <button type="button" onClick={() => openTitleComposer('receivable')} className="group flex items-center gap-2 rounded-xl bg-slate-950/55 px-3 py-2.5 text-left transition hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><span className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-200"><ArrowDownToLine className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-xs font-bold text-slate-100">Nova conta a receber</span><span className="block text-[10px] text-slate-500">Cliente, vencimento e valor</span></span><ChevronRight className="ml-auto h-4 w-4 text-slate-600 group-hover:text-emerald-200" /></button>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Atalho da rotina</p>
            <p className="mt-1 text-sm font-bold text-white">Recebeu uma compra?</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">O recebimento já cria a conta a pagar e atualiza o estoque.</p>
            <button type="button" onClick={() => navigate('purchases')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-sky-300 hover:text-sky-100">Ir para compras <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </section>

        {titleComposerOpen && <section className="rounded-2xl border border-violet-400/30 bg-slate-900/85 p-3.5" aria-labelledby="financial-title-create-heading">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Novo lançamento previsto</p><h3 id="financial-title-create-heading" className="mt-1 text-sm font-bold text-white">{titleDirection === 'payable' ? 'Conta a pagar' : 'Conta a receber'}</h3></div><button type="button" onClick={() => setTitleComposerOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar formulário de título"><X className="h-4 w-4" /></button></div>
          <form className="mt-3 grid gap-2 md:grid-cols-6" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/titles', { direction: titleDirection, description: titleDescription, counterpartyName: titleCounterparty, originalAmount: Number(titleAmount), dueDate: titleDueDate, paymentMethod: titlePaymentMethod, categoryId: titleCategoryId || undefined }, 'Título financeiro criado.'); if (result) { setTitleDescription(''); setTitleCounterparty(''); setTitleAmount('0'); setTitleComposerOpen(false); } }}>
            <select value={titleDirection} onChange={(event) => setTitleDirection(event.target.value as FinancialTitle['direction'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-violet-400 focus:outline-none"><option value="payable">Conta a pagar</option><option value="receivable">Conta a receber</option></select>
            <input value={titleDueDate} onChange={(event) => setTitleDueDate(event.target.value)} required type="date" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-violet-400 focus:outline-none" />
            <input value={titleDescription} onChange={(event) => setTitleDescription(event.target.value)} required minLength={2} maxLength={180} placeholder="Descrição" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-violet-400 focus:outline-none md:col-span-2" />
            <input value={titleCounterparty} onChange={(event) => setTitleCounterparty(event.target.value)} required minLength={2} maxLength={120} placeholder={titleDirection === 'payable' ? 'Fornecedor' : 'Cliente'} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-violet-400 focus:outline-none" />
            <input value={titleAmount} onChange={(event) => setTitleAmount(event.target.value)} required inputMode="decimal" placeholder="Valor" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-violet-400 focus:outline-none" />
            <select value={titleCategoryId} onChange={(event) => setTitleCategoryId(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-violet-400 focus:outline-none"><option value="">Sem categoria</option>{categories.filter((category) => category.active && (titleDirection === 'payable' ? category.kind !== 'income' : category.kind === 'income')).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select value={titlePaymentMethod} onChange={(event) => setTitlePaymentMethod(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-violet-400 focus:outline-none"><option>PIX</option><option>Transferência Bancária</option><option>Cartão de Crédito</option><option>Boleto Bancário</option></select>
            <button disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-violet-200 disabled:opacity-50 md:col-span-2"><CirclePlus className="h-3.5 w-3.5" /> Criar título</button>
          </form>
        </section>}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" aria-labelledby="financial-titles-list-heading">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Previsão e baixa</p><h3 id="financial-titles-list-heading" className="mt-1 text-sm font-bold text-white">Acompanhar títulos</h3></div><div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Filtros de títulos">{([{ key: 'all', label: 'Todos' }, { key: 'payable', label: 'A pagar' }, { key: 'receivable', label: 'A receber' }, { key: 'overdue', label: 'Vencidos' }] as Array<{ key: TitleFilter; label: string }>).map((filter) => <button key={filter.key} type="button" onClick={() => { setTitleFilter(filter.key); setTitleLimit(8); }} aria-pressed={titleFilter === filter.key} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${titleFilter === filter.key ? 'bg-violet-300 text-slate-950' : 'bg-slate-950/60 text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{filter.label}</button>)}</div></div>
          <div className="mt-3 space-y-1.5">{visibleTitles.length ? visibleTitles.slice(0, titleLimit).map((title) => <article key={title.id} className="rounded-xl bg-slate-950/45 px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-100">{title.description}</p><p className="mt-0.5 text-[10px] text-slate-500">{title.direction === 'payable' ? 'A pagar' : 'A receber'} · {title.counterpartyName} · vence {new Date(`${title.dueDate}T12:00:00`).toLocaleDateString(locale || 'pt-BR')}</p></div><div className="shrink-0 text-right"><p className="text-xs font-bold text-slate-200">{formatMoney(title.openAmount, currency, locale)}</p><p className={`mt-0.5 text-[10px] font-semibold ${title.status === 'overdue' ? 'text-rose-300' : title.status === 'settled' ? 'text-emerald-300' : 'text-violet-200'}`}>{titleStatusLabel(title.status)}</p></div></div>{!['settled', 'cancelled'].includes(title.status) && <div className="mt-2 flex flex-wrap gap-2"><select value={settlementAccountByTitle[title.id] || accounts.find((account) => account.active)?.id || ''} onChange={(event) => setSettlementAccountByTitle((current) => ({ ...current, [title.id]: event.target.value }))} disabled={saving || !accounts.length} className="min-w-36 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] text-white focus:border-violet-400 focus:outline-none"><option value="">Selecione a conta</option>{accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button type="button" onClick={() => settleTitle(title)} disabled={saving || !accounts.length} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-400 px-2 py-1.5 text-[10px] font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50">{title.direction === 'payable' ? <ArrowUpFromLine className="h-3.5 w-3.5" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}{title.direction === 'payable' ? 'Pagar' : 'Receber'}</button></div>}</article>) : <div className="rounded-xl bg-slate-950/45 px-3 py-6 text-center text-xs text-slate-500">Nenhum título neste filtro.</div>}</div>
          {visibleTitles.length > titleLimit && <button type="button" onClick={() => setTitleLimit((current) => current + 8)} className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">Ver mais {Math.min(8, visibleTitles.length - titleLimit)} título{visibleTitles.length - titleLimit === 1 ? '' : 's'}</button>}
          {!accounts.length && openTitles.length > 0 && <button type="button" onClick={() => navigate('structure')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-200 hover:text-amber-100"><AlertTriangle className="h-3.5 w-3.5" /> Cadastre uma conta para realizar baixas <ChevronRight className="h-3.5 w-3.5" /></button>}
        </section>
      </>}

      {activeSection === 'purchases' && <>
        <section className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Entrada rastreável</p><h3 className="mt-1 text-sm font-bold text-white">{purchases.filter((purchase) => purchase.status === 'draft').length} compra{purchases.filter((purchase) => purchase.status === 'draft').length === 1 ? '' : 's'} aguardando recebimento</h3><p className="mt-1 text-xs text-slate-400">Receba a mercadoria uma vez: estoque e conta a pagar são atualizados juntos.</p></div><button type="button" onClick={() => setPurchaseComposerOpen((open) => !open)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-200"><Plus className="h-3.5 w-3.5" /> Nova compra</button></div></section>
        {!items.length && <section className="rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4"><p className="text-sm font-bold text-amber-100">Cadastre um item antes de criar uma compra.</p><p className="mt-1 text-xs text-slate-400">O item comprado é a referência que atualiza o estoque.</p><button type="button" onClick={() => navigate('inventory')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-200 hover:text-amber-100">Cadastrar item no estoque <ChevronRight className="h-3.5 w-3.5" /></button></section>}
        {purchaseComposerOpen && <section className="rounded-2xl border border-sky-400/30 bg-slate-900/85 p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Novo abastecimento</p><h3 className="mt-1 text-sm font-bold text-white">Criar compra</h3></div><button type="button" onClick={() => setPurchaseComposerOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar formulário de compra"><X className="h-4 w-4" /></button></div><form className="mt-3 grid gap-2 md:grid-cols-6" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/purchases', { supplierName, paymentMethod: purchasePaymentMethod, items: [{ inventoryItemId: purchaseItemId, quantity: Number(purchaseQuantity), unitCost: Number(purchaseUnitCost) }] }, 'Compra criada como rascunho.'); if (result) { setSupplierName(''); setPurchaseQuantity('1'); setPurchaseUnitCost('0'); setPurchaseComposerOpen(false); } }}><input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required minLength={2} placeholder="Fornecedor" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none md:col-span-2" /><select value={purchaseItemId} onChange={(event) => setPurchaseItemId(event.target.value)} required className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:border-sky-400 focus:outline-none md:col-span-2"><option value="">Selecione um item</option>{items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} required inputMode="decimal" placeholder="Quantidade" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none" /><input value={purchaseUnitCost} onChange={(event) => setPurchaseUnitCost(event.target.value)} required inputMode="decimal" placeholder="Custo unitário" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none" /><select value={purchasePaymentMethod} onChange={(event) => setPurchasePaymentMethod(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-sky-400 focus:outline-none md:col-span-2"><option>PIX</option><option>Transferência Bancária</option><option>Cartão de Crédito</option><option>Boleto Bancário</option></select><button disabled={saving || !items.length} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-200 disabled:opacity-50 md:col-span-2"><ShoppingCart className="h-3.5 w-3.5" /> Criar compra</button></form></section>}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Histórico recente</p><h3 className="mt-1 text-sm font-bold text-white">Compras cadastradas</h3></div><span className="rounded-full bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-slate-400">{purchases.length} no total</span></div><div className="mt-3 grid gap-2 lg:grid-cols-2">{purchases.length ? purchases.slice(0, purchaseLimit).map((purchase) => <article key={purchase.id} className="rounded-xl bg-slate-950/45 px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-100">{purchase.supplierName}</p><p className="mt-0.5 text-[10px] text-slate-500">{purchase.status === 'draft' ? 'Aguardando recebimento' : purchase.status === 'received' ? 'Recebida e vinculada ao título' : purchase.status}</p></div><span className="shrink-0 text-xs font-bold text-slate-300">{formatMoney(purchase.totalAmount, currency, locale)}</span></div>{purchase.status === 'draft' && <button disabled={saving} onClick={() => receivePurchase(purchase.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 hover:text-emerald-100 disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" /> Receber e gerar conta a pagar</button>}</article>) : <div className="rounded-xl bg-slate-950/45 px-3 py-6 text-center text-xs text-slate-500 lg:col-span-2">Nenhuma compra cadastrada.</div>}</div>{purchases.length > purchaseLimit && <button type="button" onClick={() => setPurchaseLimit((current) => current + 6)} className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">Ver mais compras</button>}</section>
      </>}

      {activeSection === 'inventory' && <>
        <section className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Saldo e reposição</p><h3 className="mt-1 text-sm font-bold text-white">{lowStockItems.length ? `${lowStockItems.length} item${lowStockItems.length === 1 ? '' : 's'} precisam de reposição` : 'Estoque sem alertas de reposição'}</h3><p className="mt-1 text-xs text-slate-400">Use o ponto mínimo de cada item para antecipar a próxima compra.</p></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${lowStockItems.length ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}`}>{lowStockItems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{lowStockItems.length ? 'Repor agora' : 'Tudo em dia'}</span></div></div><div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Ação rápida</p><p className="mt-1 text-sm font-bold text-white">Novo item de estoque</p><p className="mt-1 text-xs text-slate-400">Cadastre produto ou insumo antes de realizar a compra.</p><button type="button" onClick={() => setInventoryComposerOpen((open) => !open)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-200"><Plus className="h-3.5 w-3.5" /> Adicionar item</button></div></section>
        {inventoryComposerOpen && <section className="rounded-2xl border border-amber-400/30 bg-slate-900/85 p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Cadastro de estoque</p><h3 className="mt-1 text-sm font-bold text-white">Adicionar item</h3></div><button type="button" onClick={() => setInventoryComposerOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar formulário de estoque"><X className="h-4 w-4" /></button></div><form className="mt-3 grid gap-2 md:grid-cols-6" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/inventory/items', { name: itemName, sku: itemSku || undefined, itemType, unit: itemUnit, reorderPoint: Number(itemReorderPoint) }, 'Item de estoque criado.'); if (result) { setItemName(''); setItemSku(''); setItemReorderPoint('0'); setInventoryComposerOpen(false); } }}><input value={itemName} onChange={(event) => setItemName(event.target.value)} required minLength={2} placeholder="Nome do item" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none md:col-span-2" /><input value={itemSku} onChange={(event) => setItemSku(event.target.value)} placeholder="SKU opcional" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none" /><select value={itemType} onChange={(event) => setItemType(event.target.value as InventoryItem['itemType'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"><option value="supply">Insumo</option><option value="product">Produto</option></select><input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} required placeholder="Unidade" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none" /><input value={itemReorderPoint} onChange={(event) => setItemReorderPoint(event.target.value)} required inputMode="decimal" placeholder="Estoque mínimo" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none" /><button disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-200 disabled:opacity-50 md:col-span-2"><CirclePlus className="h-3.5 w-3.5" /> Adicionar item</button></form></section>}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Itens cadastrados</p><h3 className="mt-1 text-sm font-bold text-white">Estoque atual</h3></div><span className="rounded-full bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-slate-400">{items.length} itens</span></div><div className="mt-3 grid gap-2 lg:grid-cols-2">{items.length ? items.slice(0, itemLimit).map((item) => <article key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/45 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-100">{item.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{item.itemType === 'supply' ? 'Insumo' : 'Produto'} · mínimo {item.reorderPoint} {item.unit} · custo {formatMoney(item.averageUnitCost, currency, locale)}</p></div><span className={`shrink-0 text-sm font-bold ${item.onHandQuantity <= item.reorderPoint ? 'text-amber-300' : 'text-emerald-300'}`}>{item.onHandQuantity} {item.unit}</span></article>) : <div className="rounded-xl bg-slate-950/45 px-3 py-6 text-center text-xs text-slate-500 lg:col-span-2">Cadastre um item para iniciar o controle de estoque.</div>}</div>{items.length > itemLimit && <button type="button" onClick={() => setItemLimit((current) => current + 8)} className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">Ver mais itens</button>}</section>
      </>}

      {activeSection === 'structure' && <>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-2" aria-label="Tipo de configuração"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setStructureSection('categories'); setStructureComposerOpen(false); }} aria-pressed={structureSection === 'categories'} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition ${structureSection === 'categories' ? 'bg-emerald-500/12 text-emerald-100' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Tags className="h-4 w-4 shrink-0" /><span><span className="block text-xs font-bold">Categorias</span><span className="block text-[10px] opacity-70">{categories.length} cadastrada{categories.length === 1 ? '' : 's'}</span></span></button><button type="button" onClick={() => { setStructureSection('accounts'); setStructureComposerOpen(false); }} aria-pressed={structureSection === 'accounts'} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition ${structureSection === 'accounts' ? 'bg-sky-500/12 text-sky-100' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Landmark className="h-4 w-4 shrink-0" /><span><span className="block text-xs font-bold">Contas</span><span className="block text-[10px] opacity-70">{accounts.length} cadastrada{accounts.length === 1 ? '' : 's'}</span></span></button></div></section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${structureSection === 'categories' ? 'text-emerald-300' : 'text-sky-300'}`}>{structureSection === 'categories' ? 'Classificação financeira' : 'Destino de caixa'}</p><h3 className="mt-1 text-sm font-bold text-white">{structureSection === 'categories' ? 'Categorias financeiras' : 'Contas financeiras'}</h3><p className="mt-1 text-xs text-slate-400">{structureSection === 'categories' ? 'Use categorias para organizar receitas, despesas e custos.' : 'Cadastre onde o dinheiro entra ou sai para realizar baixas.'}</p></div><button type="button" onClick={() => setStructureComposerOpen((open) => !open)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-950 transition ${structureSection === 'categories' ? 'bg-emerald-300 hover:bg-emerald-200' : 'bg-sky-300 hover:bg-sky-200'}`}><Plus className="h-3.5 w-3.5" /> {structureSection === 'categories' ? 'Nova categoria' : 'Nova conta'}</button></div>
          {structureComposerOpen && (structureSection === 'categories' ? <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_.8fr_auto]" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/categories', { name: categoryName, kind: categoryKind }, 'Categoria criada.'); if (result) { setCategoryName(''); setStructureComposerOpen(false); } }}><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required minLength={2} maxLength={80} placeholder="Ex.: Insumos" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /><select value={categoryKind} onChange={(event) => setCategoryKind(event.target.value as Category['kind'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option value="income">Receita</option><option value="expense">Despesa</option><option value="cost">Custo</option></select><button disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50"><CirclePlus className="h-3.5 w-3.5" /> Adicionar</button></form> : <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/accounts', { name: accountName, accountType, openingBalance: Number(openingBalance) }, 'Conta financeira criada.'); if (result) { setAccountName(''); setOpeningBalance('0'); setStructureComposerOpen(false); } }}><input value={accountName} onChange={(event) => setAccountName(event.target.value)} required minLength={2} maxLength={80} placeholder="Ex.: Banco principal" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none md:col-span-2" /><select value={accountType} onChange={(event) => setAccountType(event.target.value as Account['accountType'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"><option value="cash">Caixa</option><option value="bank">Banco</option><option value="digital_wallet">Carteira</option><option value="card">Cartão</option></select><input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" required placeholder="Saldo inicial" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none" /><button disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-200 disabled:opacity-50 md:col-span-4"><CirclePlus className="h-3.5 w-3.5" /> Adicionar conta</button></form>)}
          {structureSection === 'categories' ? <div className="mt-3 flex flex-wrap gap-1.5">{categories.length ? categories.map((category) => <span key={category.id} className="rounded-full bg-slate-950/65 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300">{category.name} <span className="font-normal text-slate-500">· {categoryLabel[category.kind]}</span></span>) : <span className="text-xs text-slate-500">Sem categorias cadastradas.</span>}</div> : <div className="mt-3 grid gap-2 lg:grid-cols-2">{accounts.length ? accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/45 px-3 py-2.5 text-xs"><span className="min-w-0 truncate font-semibold text-slate-200">{account.name} <span className="font-normal text-slate-500">· {accountLabel[account.accountType]}</span></span><span className="shrink-0 text-slate-400">{formatMoney(account.openingBalance, currency, locale)}</span></div>) : <span className="text-xs text-slate-500">Sem contas cadastradas.</span>}</div>}
        </section>
      </>}
    </section>
  );
}
