/**
 * Financeiro operacional: interface compacta e progressiva para tenants que
 * receberam `sales.financial`. Mantém estrutura, estoque e compras fora da
 * navegação global, evitando poluição do painel de empresas não habilitadas.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Box, CheckCircle2, CirclePlus, Landmark, PackageCheck, RefreshCw, ShoppingCart, Tags } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type Category = { id: string; name: string; kind: 'income' | 'expense' | 'cost'; active: boolean };
type Account = { id: string; name: string; accountType: 'cash' | 'bank' | 'digital_wallet' | 'card'; openingBalance: number; active: boolean };
type InventoryItem = { id: string; name: string; sku?: string; itemType: 'product' | 'supply'; unit: string; onHandQuantity: number; reorderPoint: number; averageUnitCost: number; active: boolean };
type Purchase = { id: string; supplierName: string; status: 'draft' | 'receiving' | 'received' | 'cancelled'; paymentMethod: string; totalAmount: number; receivedAt?: string };

interface FinancialOperationsCenterProps {
  currency: string;
  locale: string;
  onToast: (message: string) => void;
}

const formatMoney = (value: number, currency: string, locale: string) => new Intl.NumberFormat(locale || 'pt-BR', { style: 'currency', currency: currency || 'BRL', maximumFractionDigits: currency === 'PYG' ? 0 : 2 }).format(value || 0);
const categoryLabel: Record<Category['kind'], string> = { income: 'Receita', expense: 'Despesa', cost: 'Custo' };
const accountLabel: Record<Account['accountType'], string> = { cash: 'Caixa', bank: 'Banco', digital_wallet: 'Carteira digital', card: 'Cartão' };

export function FinancialOperationsCenter({ currency, locale, onToast }: FinancialOperationsCenterProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
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

  const lowStockItems = useMemo(() => items.filter((item) => item.onHandQuantity <= item.reorderPoint), [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all([
        apiFetch('/api/financial/categories'),
        apiFetch('/api/financial/accounts'),
        apiFetch('/api/financial/inventory/items'),
        apiFetch('/api/financial/purchases'),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error('Não foi possível carregar a estrutura operacional.');
      const [categoryData, accountData, itemData, purchaseData] = await Promise.all(responses.map((response) => response.json()));
      setCategories(categoryData.categories || []);
      setAccounts(accountData.accounts || []);
      setItems(itemData.items || []);
      setPurchases(purchaseData.purchases || []);
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
      onToast('Compra recebida: estoque e despesa pendente atualizados.');
    } catch (receiveError: any) {
      setError(receiveError.message || 'Não foi possível receber a compra.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="financial-operations-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/65 px-4 py-3.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">Estrutura operacional</p>
          <h2 id="financial-operations-heading" className="mt-1 text-base font-bold text-white">Categorias, contas, estoque e compras</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Cadastre a estrutura uma vez e receba compras com rastreabilidade: o estoque sobe e uma despesa pendente é criada automaticamente.</p>
        </div>
        <button type="button" onClick={load} disabled={loading || saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}

      <div className="grid gap-3 xl:grid-cols-3">
        <details className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-white"><Tags className="h-4 w-4 text-emerald-300" /> Categorias <span className="ml-auto text-xs font-medium text-slate-500">{categories.length}</span></summary>
          <form className="mt-3 space-y-2" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/categories', { name: categoryName, kind: categoryKind }, 'Categoria criada.'); if (result) setCategoryName(''); }}>
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required minLength={2} maxLength={80} placeholder="Ex.: Insumos" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" />
            <select value={categoryKind} onChange={(event) => setCategoryKind(event.target.value as Category['kind'])} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option value="income">Receita</option><option value="expense">Despesa</option><option value="cost">Custo</option></select>
            <button disabled={saving} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-400 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"><CirclePlus className="h-3.5 w-3.5" /> Adicionar categoria</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">{categories.length ? categories.map((category) => <span key={category.id} className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300">{category.name} · {categoryLabel[category.kind]}</span>) : <span className="text-xs text-slate-500">Sem categorias cadastradas.</span>}</div>
        </details>

        <details className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-white"><Landmark className="h-4 w-4 text-sky-300" /> Contas financeiras <span className="ml-auto text-xs font-medium text-slate-500">{accounts.length}</span></summary>
          <form className="mt-3 space-y-2" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/accounts', { name: accountName, accountType, openingBalance: Number(openingBalance) }, 'Conta financeira criada.'); if (result) { setAccountName(''); setOpeningBalance('0'); } }}>
            <input value={accountName} onChange={(event) => setAccountName(event.target.value)} required minLength={2} maxLength={80} placeholder="Ex.: Banco principal" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" />
            <div className="grid grid-cols-2 gap-2"><select value={accountType} onChange={(event) => setAccountType(event.target.value as Account['accountType'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option value="cash">Caixa</option><option value="bank">Banco</option><option value="digital_wallet">Carteira</option><option value="card">Cartão</option></select><input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" required placeholder="Saldo inicial" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /></div>
            <button disabled={saving} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-400 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50"><CirclePlus className="h-3.5 w-3.5" /> Adicionar conta</button>
          </form>
          <div className="mt-3 space-y-1.5">{accounts.length ? accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/55 px-2.5 py-2 text-xs"><span className="min-w-0 truncate font-semibold text-slate-200">{account.name} <span className="font-normal text-slate-500">· {accountLabel[account.accountType]}</span></span><span className="shrink-0 text-slate-400">{formatMoney(account.openingBalance, currency, locale)}</span></div>) : <span className="text-xs text-slate-500">Sem contas cadastradas.</span>}</div>
        </details>

        <details className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-white"><Box className="h-4 w-4 text-amber-300" /> Itens de estoque <span className="ml-auto text-xs font-medium text-slate-500">{items.length}</span></summary>
          <form className="mt-3 space-y-2" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/inventory/items', { name: itemName, sku: itemSku || undefined, itemType, unit: itemUnit, reorderPoint: Number(itemReorderPoint) }, 'Item de estoque criado.'); if (result) { setItemName(''); setItemSku(''); setItemReorderPoint('0'); } }}>
            <div className="grid grid-cols-2 gap-2"><input value={itemName} onChange={(event) => setItemName(event.target.value)} required minLength={2} placeholder="Nome do item" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /><input value={itemSku} onChange={(event) => setItemSku(event.target.value)} placeholder="SKU opcional" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /></div>
            <div className="grid grid-cols-3 gap-2"><select value={itemType} onChange={(event) => setItemType(event.target.value as InventoryItem['itemType'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option value="supply">Insumo</option><option value="product">Produto</option></select><input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} required placeholder="un" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /><input value={itemReorderPoint} onChange={(event) => setItemReorderPoint(event.target.value)} required inputMode="decimal" placeholder="Mín." className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /></div>
            <button disabled={saving} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-300 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-200 disabled:opacity-50"><CirclePlus className="h-3.5 w-3.5" /> Adicionar item</button>
          </form>
        </details>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" aria-labelledby="inventory-list-heading">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Saldo e reposição</p><h3 id="inventory-list-heading" className="mt-1 text-sm font-bold text-white">Estoque atual</h3></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${lowStockItems.length ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}`}>{lowStockItems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{lowStockItems.length ? `${lowStockItems.length} para repor` : 'Sem alertas'}</span></div>
          <div className="mt-3 space-y-1.5">{items.length ? items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/45 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-100">{item.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{item.itemType === 'supply' ? 'Insumo' : 'Produto'} · mínimo {item.reorderPoint} {item.unit} · custo {formatMoney(item.averageUnitCost, currency, locale)}</p></div><span className={`shrink-0 text-sm font-bold ${item.onHandQuantity <= item.reorderPoint ? 'text-amber-300' : 'text-emerald-300'}`}>{item.onHandQuantity} {item.unit}</span></div>) : <div className="rounded-xl bg-slate-950/45 px-3 py-5 text-center text-xs text-slate-500">Cadastre um item para iniciar o controle de estoque.</div>}</div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5" aria-labelledby="purchase-heading">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Entrada rastreável</p><h3 id="purchase-heading" className="mt-1 text-sm font-bold text-white">Nova compra</h3></div>
          <form className="mt-3 space-y-2" onSubmit={async (event) => { event.preventDefault(); const result = await submit('/api/financial/purchases', { supplierName, paymentMethod: purchasePaymentMethod, items: [{ inventoryItemId: purchaseItemId, quantity: Number(purchaseQuantity), unitCost: Number(purchaseUnitCost) }] }, 'Compra criada como rascunho.'); if (result) { setSupplierName(''); setPurchaseQuantity('1'); setPurchaseUnitCost('0'); } }}>
            <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required minLength={2} placeholder="Fornecedor" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" />
            <select value={purchaseItemId} onChange={(event) => setPurchaseItemId(event.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option value="">Selecione um item</option>{items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <div className="grid grid-cols-3 gap-2"><input value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} required inputMode="decimal" placeholder="Qtd." className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /><input value={purchaseUnitCost} onChange={(event) => setPurchaseUnitCost(event.target.value)} required inputMode="decimal" placeholder="Custo" className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none" /><select value={purchasePaymentMethod} onChange={(event) => setPurchasePaymentMethod(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"><option>PIX</option><option>Transferência Bancária</option><option>Cartão de Crédito</option><option>Boleto Bancário</option></select></div>
            <button disabled={saving || !items.length} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-400 px-2.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50"><ShoppingCart className="h-3.5 w-3.5" /> Criar compra</button>
          </form>
          <div className="mt-3 space-y-1.5">{purchases.slice(0, 4).map((purchase) => <div key={purchase.id} className="rounded-lg bg-slate-950/45 px-2.5 py-2"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-slate-200">{purchase.supplierName}</span><span className="shrink-0 text-[10px] text-slate-500">{formatMoney(purchase.totalAmount, currency, locale)}</span></div>{purchase.status === 'draft' ? <button disabled={saving} onClick={() => receivePurchase(purchase.id)} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 hover:text-emerald-100 disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" /> Receber e lançar despesa</button> : <span className="mt-1.5 inline-block text-[10px] font-semibold text-slate-500">Recebida</span>}</div>)}</div>
        </section>
      </div>
    </section>
  );
}
