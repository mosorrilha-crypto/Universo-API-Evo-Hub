/**
 * Agenda móvel — reduz a entrada à rotina “Hoje” e revela o mês apenas
 * quando o operador precisa navegar por datas futuras.
 */
import { useState } from 'react';
import { AlertCircle, CalendarDays, ListChecks } from 'lucide-react';
import { AgendaFinanceiroCenter } from './AgendaFinanceiroCenter';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, RecurringExpense, UserProfile } from '../types';

type AgendaMobileView = 'today' | 'calendar' | 'pending';

interface AgendaWorkspaceProps {
  transactions: FinancialTransaction[];
  leads: LeadInfo[];
  currentUser: UserProfile;
  currency?: string;
  locale?: string;
  onAddTransaction: (transaction: FinancialTransaction) => Promise<boolean>;
  onUpdateTransactionStatus: (id: string, status: PaymentStatus) => Promise<void> | void;
  onDeleteTransaction: (id: string) => Promise<void> | void;
  financialModuleEnabled?: boolean;
  onToast: (message: string) => void;
  recurringExpenses?: RecurringExpense[];
  onAddRecurringExpense?: (input: { description: string; amount: number; paymentMethod: PaymentMethod; dayOfMonth: number }) => Promise<boolean>;
  onToggleRecurringExpense?: (id: string, active: boolean) => void;
  onDeleteRecurringExpense?: (id: string) => void;
}

export function AgendaWorkspace(props: AgendaWorkspaceProps) {
  const [mobileView, setMobileView] = useState<AgendaMobileView>('today');

  return (
    <div className="agenda-mobile-workspace space-y-3">
      <nav className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-950/95 p-1.5 sm:hidden" aria-label="Visão da Agenda">
        <button type="button" onClick={() => setMobileView('today')} aria-current={mobileView === 'today' ? 'page' : undefined} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition ${mobileView === 'today' ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><ListChecks className="h-4 w-4" /> Hoje</button>
        <button type="button" onClick={() => setMobileView('calendar')} aria-current={mobileView === 'calendar' ? 'page' : undefined} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition ${mobileView === 'calendar' ? 'bg-sky-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><CalendarDays className="h-4 w-4" /> Calendário</button>
        <button type="button" onClick={() => setMobileView('pending')} aria-current={mobileView === 'pending' ? 'page' : undefined} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition ${mobileView === 'pending' ? 'bg-amber-300 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><AlertCircle className="h-4 w-4" /> Pendências</button>
      </nav>
      <AgendaFinanceiroCenter scope="agenda" transactions={props.transactions} onAddTransaction={props.onAddTransaction} onUpdateTransactionStatus={props.onUpdateTransactionStatus} onDeleteTransaction={props.onDeleteTransaction} leads={props.leads} currentUser={props.currentUser} currency={props.currency} locale={props.locale} financialModuleEnabled={props.financialModuleEnabled} onToast={props.onToast} recurringExpenses={props.recurringExpenses} onAddRecurringExpense={props.onAddRecurringExpense} onToggleRecurringExpense={props.onToggleRecurringExpense} onDeleteRecurringExpense={props.onDeleteRecurringExpense} mobileAgendaView={mobileView} />
    </div>
  );
}
