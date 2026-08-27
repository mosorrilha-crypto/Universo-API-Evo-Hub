/**
 * Financeiro móvel — navegação de uma tela: três áreas principais e um menu
 * “Mais”, com detalhes longos abertos somente sob demanda.
 */
import { useState } from 'react';
import { BarChart3, Box, ChevronDown, Landmark, ReceiptText, ShoppingCart } from 'lucide-react';
import { AgendaFinanceiroCenter } from './AgendaFinanceiroCenter';
import { FinancialOperationsCenter, type FinancialOperationsSection } from './FinancialOperationsCenter';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, RecurringExpense, UserProfile } from '../types';

type FinancialWorkspaceView = 'summary' | FinancialOperationsSection;
type MobileDetail = 'flow' | 'recurring' | null;

interface FinancialWorkspaceProps {
  transactions: FinancialTransaction[];
  leads: LeadInfo[];
  currentUser: UserProfile;
  currency?: string;
  locale?: string;
  onAddTransaction: (transaction: FinancialTransaction) => Promise<boolean>;
  onUpdateTransactionStatus: (id: string, status: PaymentStatus) => Promise<void> | void;
  onDeleteTransaction: (id: string) => Promise<void> | void;
  onToast: (message: string) => void;
  recurringExpenses?: RecurringExpense[];
  onAddRecurringExpense?: (input: { description: string; amount: number; paymentMethod: PaymentMethod; dayOfMonth: number }) => Promise<boolean>;
  onToggleRecurringExpense?: (id: string, active: boolean) => void;
  onDeleteRecurringExpense?: (id: string) => void;
}

const workspaceItems: Array<{ id: FinancialWorkspaceView; label: string; mobileLabel: string; description: string; icon: typeof BarChart3 }> = [
  { id: 'summary', label: 'Visão financeira', mobileLabel: 'Resumo', description: 'Caixa e lançamentos', icon: BarChart3 },
  { id: 'titles', label: 'Contas a pagar e receber', mobileLabel: 'Títulos', description: 'Vencimentos e baixas', icon: ReceiptText },
  { id: 'purchases', label: 'Compras', mobileLabel: 'Compras', description: 'Recebimento e custos', icon: ShoppingCart },
  { id: 'inventory', label: 'Estoque', mobileLabel: 'Estoque', description: 'Saldo e reposição', icon: Box },
  { id: 'structure', label: 'Categorias e contas', mobileLabel: 'Estrutura', description: 'Configuração', icon: Landmark },
];

const mobilePrimaryItems = workspaceItems.slice(0, 3);
const mobileMoreItems = workspaceItems.slice(3);

export function FinancialWorkspace(props: FinancialWorkspaceProps) {
  const [activeView, setActiveView] = useState<FinancialWorkspaceView>('summary');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState<MobileDetail>(null);
  const moreIsActive = mobileMoreItems.some((item) => item.id === activeView);

  const selectView = (view: FinancialWorkspaceView) => {
    setActiveView(view);
    setMobileDetail(null);
    setMobileMoreOpen(false);
  };

  const toggleDetail = (detail: Exclude<MobileDetail, null>) => {
    setMobileDetail((current) => current === detail ? null : detail);
  };

  return (
    <div className="financial-workspace space-y-3">
      <nav className="financial-workspace__nav sticky top-2 z-20 rounded-2xl border border-slate-800 bg-slate-950/95 p-1.5 shadow-xl shadow-slate-950/25 backdrop-blur" aria-label="Áreas do Financeiro">
        <div className="grid grid-cols-4 gap-1 sm:hidden">
          {mobilePrimaryItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeView;
            return <button key={item.id} type="button" onClick={() => selectView(item.id)} aria-pressed={active} className={`rounded-xl px-1.5 py-2 text-center transition ${active ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon className="mx-auto h-3.5 w-3.5" /><span className="mt-0.5 block text-[10px] font-bold">{item.mobileLabel}</span></button>;
          })}
          <button type="button" onClick={() => setMobileMoreOpen((open) => !open)} aria-expanded={mobileMoreOpen} aria-haspopup="menu" className={`rounded-xl px-1.5 py-2 text-center transition ${moreIsActive || mobileMoreOpen ? 'bg-sky-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><ChevronDown className={`mx-auto h-3.5 w-3.5 transition-transform ${mobileMoreOpen ? 'rotate-180' : ''}`} /><span className="mt-0.5 block text-[10px] font-bold">Mais</span></button>
        </div>
        {mobileMoreOpen && <div role="menu" className="mt-1 grid grid-cols-2 gap-1 sm:hidden">{mobileMoreItems.map((item) => { const Icon = item.icon; const active = item.id === activeView; return <button key={item.id} type="button" role="menuitem" onClick={() => selectView(item.id)} aria-pressed={active} className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-sky-400 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'}`}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="text-[11px] font-bold">{item.mobileLabel}</span></button>; })}</div>}
        <div className="hidden gap-1 sm:grid sm:grid-cols-5">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeView;
            return <button key={item.id} type="button" onClick={() => selectView(item.id)} aria-pressed={active} className={`group min-w-0 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="hidden text-[11px] font-bold lg:inline">{item.label}</span><span className="text-[11px] font-bold lg:hidden">{item.mobileLabel}</span></span><span className={`mt-0.5 block truncate text-[9px] ${active ? 'text-slate-800' : 'text-slate-600 group-hover:text-slate-400'}`}>{item.description}</span></button>;
          })}
        </div>
      </nav>

      {activeView === 'summary' && <section className="financial-workspace__mobile-details grid grid-cols-2 gap-2 sm:hidden" aria-label="Detalhes financeiros"><button type="button" onClick={() => toggleDetail('flow')} aria-expanded={mobileDetail === 'flow'} className={`rounded-xl border px-3 py-2 text-left transition ${mobileDetail === 'flow' ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-slate-700 bg-slate-900/65 text-slate-200 hover:bg-slate-800'}`}><span className="block text-[10px] font-bold uppercase tracking-wide">Movimentações</span><span className="mt-0.5 block text-xs font-bold">Fluxo financeiro</span></button><button type="button" onClick={() => toggleDetail('recurring')} aria-expanded={mobileDetail === 'recurring'} className={`rounded-xl border px-3 py-2 text-left transition ${mobileDetail === 'recurring' ? 'border-sky-400 bg-sky-400 text-slate-950' : 'border-slate-700 bg-slate-900/65 text-slate-200 hover:bg-slate-800'}`}><span className="block text-[10px] font-bold uppercase tracking-wide">Automação</span><span className="mt-0.5 block text-xs font-bold">Recorrências</span></button></section>}

      {mobileDetail && <button type="button" onClick={() => setMobileDetail(null)} className="financial-workspace__mobile-detail-close sm:hidden">Fechar detalhes</button>}

      <div hidden={activeView !== 'summary'}>
        <AgendaFinanceiroCenter scope="financial" transactions={props.transactions} onAddTransaction={props.onAddTransaction} onUpdateTransactionStatus={props.onUpdateTransactionStatus} onDeleteTransaction={props.onDeleteTransaction} leads={props.leads} currentUser={props.currentUser} currency={props.currency} locale={props.locale} onToast={props.onToast} recurringExpenses={props.recurringExpenses} onAddRecurringExpense={props.onAddRecurringExpense} onToggleRecurringExpense={props.onToggleRecurringExpense} onDeleteRecurringExpense={props.onDeleteRecurringExpense} mobileDetail={mobileDetail} />
      </div>
      <div hidden={activeView === 'summary'}>
        <FinancialOperationsCenter currency={props.currency || 'BRL'} locale={props.locale || 'pt-BR'} onToast={props.onToast} activeSection={activeView === 'summary' ? 'titles' : activeView} onNavigateToSection={selectView} />
      </div>
    </div>
  );
}
