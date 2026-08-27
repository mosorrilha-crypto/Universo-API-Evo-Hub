/**
 * Navegador compacto do Financeiro: uma área de trabalho por vez, priorizando
 * a ação necessária e evitando que o operador percorra cadastros longos.
 */
import { useState } from 'react';
import { BarChart3, Box, Landmark, ReceiptText, ShoppingCart } from 'lucide-react';
import { AgendaFinanceiroCenter } from './AgendaFinanceiroCenter';
import { FinancialOperationsCenter, type FinancialOperationsSection } from './FinancialOperationsCenter';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, RecurringExpense, UserProfile } from '../types';

type FinancialWorkspaceView = 'summary' | FinancialOperationsSection;

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

const workspaceItems: Array<{ id: FinancialWorkspaceView; label: string; compactLabel: string; description: string; icon: typeof BarChart3 }> = [
  { id: 'summary', label: 'Visão financeira', compactLabel: 'Resumo', description: 'Caixa e lançamentos', icon: BarChart3 },
  { id: 'titles', label: 'Contas a pagar e receber', compactLabel: 'Títulos', description: 'Vencimentos e baixas', icon: ReceiptText },
  { id: 'purchases', label: 'Compras', compactLabel: 'Compras', description: 'Recebimento e custos', icon: ShoppingCart },
  { id: 'inventory', label: 'Estoque', compactLabel: 'Estoque', description: 'Saldo e reposição', icon: Box },
  { id: 'structure', label: 'Categorias e contas', compactLabel: 'Estrutura', description: 'Configuração', icon: Landmark },
];

export function FinancialWorkspace(props: FinancialWorkspaceProps) {
  const [activeView, setActiveView] = useState<FinancialWorkspaceView>('summary');

  return (
    <div className="space-y-4">
      <nav className="sticky top-2 z-20 rounded-2xl border border-slate-800 bg-slate-950/95 p-2 shadow-xl shadow-slate-950/25 backdrop-blur" aria-label="Áreas do Financeiro">
        <div className="flex gap-1 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeView;
            return <button key={item.id} type="button" onClick={() => setActiveView(item.id)} aria-pressed={active} className={`group min-w-31 shrink-0 rounded-xl px-2.5 py-2 text-left transition sm:min-w-0 ${active ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="text-[11px] font-bold sm:hidden">{item.compactLabel}</span><span className="hidden text-[11px] font-bold lg:inline">{item.label}</span><span className="hidden text-[11px] font-bold sm:inline lg:hidden">{item.compactLabel}</span></span><span className={`mt-0.5 hidden truncate text-[9px] sm:block ${active ? 'text-slate-800' : 'text-slate-600 group-hover:text-slate-400'}`}>{item.description}</span></button>;
          })}
        </div>
      </nav>

      <div hidden={activeView !== 'summary'}>
        <AgendaFinanceiroCenter scope="financial" transactions={props.transactions} onAddTransaction={props.onAddTransaction} onUpdateTransactionStatus={props.onUpdateTransactionStatus} onDeleteTransaction={props.onDeleteTransaction} leads={props.leads} currentUser={props.currentUser} currency={props.currency} locale={props.locale} onToast={props.onToast} recurringExpenses={props.recurringExpenses} onAddRecurringExpense={props.onAddRecurringExpense} onToggleRecurringExpense={props.onToggleRecurringExpense} onDeleteRecurringExpense={props.onDeleteRecurringExpense} />
      </div>
      <div hidden={activeView === 'summary'}>
        <FinancialOperationsCenter currency={props.currency || 'BRL'} locale={props.locale || 'pt-BR'} onToast={props.onToast} activeSection={activeView === 'summary' ? 'titles' : activeView} onNavigateToSection={(section) => setActiveView(section)} />
      </div>
    </div>
  );
}
