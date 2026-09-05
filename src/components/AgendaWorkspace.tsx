/**
 * Agenda móvel — reduz a entrada à rotina “Hoje” e revela o mês apenas
 * quando o operador precisa navegar por datas futuras.
 */
import { useState } from 'react';
import { CalendarDays, ListChecks } from 'lucide-react';
import { AgendaFinanceiroCenter } from './AgendaFinanceiroCenter';
import { GoogleCalendarConnectionControl } from './calendar/GoogleCalendarConnectionControl';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, RecurringExpense, UserProfile } from '../types';

type AgendaMobileView = 'today' | 'calendar';

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
      {/* TASK-0263 (pedido direto): configuração rara (trocar de conta do
          Google Calendar), não uso diário. No desktop continua com sua
          própria linha, discreta acima do fluxo principal — não há nav
          Hoje/Calendário pra dividir espaço aqui (a alternância de visão é
          o Semana/Mês de dentro da própria Agenda). */}
      <div className="hidden sm:block">
        <GoogleCalendarConnectionControl />
      </div>
      {/* TASK-0292 (pedido direto, print real: "tem três balões encima do
          calendário que podem ser otimizados") — no mobile, a conexão do
          Google Calendar e o nav Hoje/Calendário eram 2 blocos empilhados
          (mais o "+ Novo agendamento" logo abaixo, dentro da própria
          Agenda). Consolidados numa linha só: versão compacta da conexão
          (ícone + ações, tooltip com o texto completo) ao lado do nav. */}
      <div className="flex items-center gap-2 sm:hidden">
        <GoogleCalendarConnectionControl compact />
        <nav className="flex flex-1 gap-1 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/95 p-1.5" aria-label="Visão da Agenda">
          <button type="button" onClick={() => setMobileView('today')} aria-current={mobileView === 'today' ? 'page' : undefined} className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${mobileView === 'today' ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><ListChecks className="h-4 w-4" /> Hoje</button>
          <button type="button" onClick={() => setMobileView('calendar')} aria-current={mobileView === 'calendar' ? 'page' : undefined} className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${mobileView === 'calendar' ? 'bg-sky-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><CalendarDays className="h-4 w-4" /> Calendário</button>
        </nav>
      </div>
      <AgendaFinanceiroCenter scope="agenda" transactions={props.transactions} onAddTransaction={props.onAddTransaction} onUpdateTransactionStatus={props.onUpdateTransactionStatus} onDeleteTransaction={props.onDeleteTransaction} leads={props.leads} currentUser={props.currentUser} currency={props.currency} locale={props.locale} financialModuleEnabled={props.financialModuleEnabled} onToast={props.onToast} recurringExpenses={props.recurringExpenses} onAddRecurringExpense={props.onAddRecurringExpense} onToggleRecurringExpense={props.onToggleRecurringExpense} onDeleteRecurringExpense={props.onDeleteRecurringExpense} mobileAgendaView={mobileView} />
    </div>
  );
}
