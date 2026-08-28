/** Financeiro móvel — resumo denso e detalhes extensos exibidos somente quando solicitados. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  ReceiptText,
  Repeat,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { summarizeFinancialTransactions } from '../lib/agendaFinanceiroMetrics';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, RecurringExpense, UserProfile } from '../types';
import { useAppPreferences } from '../contexts/AppPreferencesContext';

type CenterView = 'agenda' | 'financial';
type CalendarEvent = {
  id: string;
  summary: string;
  startIso: string;
  endIso?: string;
  completed?: boolean;
  payment?: { amount: number; paymentMethod: PaymentMethod; status: PaymentStatus } | null;
};

type AppointmentDialogState = {
  mode: 'new' | 'edit';
  event?: CalendarEvent;
  initialDate?: string;
};

interface AgendaFinanceiroCenterProps {
  /** Define a área que está sendo exibida; cada destino de navegação mostra apenas a rotina correspondente. */
  scope: CenterView;
  transactions: FinancialTransaction[];
  leads: LeadInfo[];
  currentUser: UserProfile;
  currency?: string;
  locale?: string;
  onAddTransaction: (transaction: FinancialTransaction) => Promise<boolean>;
  onUpdateTransactionStatus: (id: string, status: PaymentStatus) => Promise<void> | void;
  onDeleteTransaction: (id: string) => Promise<void> | void;
  /** A Agenda segue disponível sem Financeiro; cobrança só aparece se o contrato liberar o módulo. */
  financialModuleEnabled?: boolean;
  onToast: (message: string) => void;
  /** Despesas recorrentes (TASK-0097) — só usado no scope="financial"; opcional pra não quebrar o uso em scope="agenda". */
  recurringExpenses?: RecurringExpense[];
  onAddRecurringExpense?: (input: { description: string; amount: number; paymentMethod: PaymentMethod; dayOfMonth: number }) => Promise<boolean>;
  onToggleRecurringExpense?: (id: string, active: boolean) => void;
  onDeleteRecurringExpense?: (id: string) => void;
  /** No celular, fluxo e recorrências abrem como detalhe em vez de alongar a página inicial. */
  mobileDetail?: 'flow' | 'recurring' | null;
  /** A Agenda abre em compromissos de hoje; calendário e pendências entram sob demanda no celular. */
  mobileAgendaView?: 'today' | 'calendar' | 'pending';
}

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'Transferência Bancária', 'Cartão de Crédito', 'Boleto Bancário', 'Link WhatsApp'];
const statusStyle: Record<PaymentStatus, string> = {
  pago: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  pendente: 'bg-amber-400/10 text-amber-200 border-amber-400/25',
  atrasado: 'bg-rose-500/10 text-rose-200 border-rose-500/25',
  cancelado: 'bg-slate-700/70 text-slate-300 border-slate-600',
};

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getApiError(data: unknown, fallback: string) {
  return typeof data === 'object' && data && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
}

export const AgendaFinanceiroCenter: React.FC<AgendaFinanceiroCenterProps> = ({
  scope,
  transactions,
  leads,
  currentUser,
  currency = 'PYG',
  locale = 'es-PY',
  onAddTransaction,
  onUpdateTransactionStatus,
  onDeleteTransaction,
  financialModuleEnabled = true,
  onToast,
  recurringExpenses = [],
  onAddRecurringExpense,
  onToggleRecurringExpense,
  onDeleteRecurringExpense,
  mobileDetail = null,
  mobileAgendaView = 'today',
}) => {
  const { language } = useAppPreferences();
  const isSpanish = language === 'es';
  const displayLocale = isSpanish ? 'es-PY' : 'pt-BR';
  const view = scope;
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [transactionType, setTransactionType] = useState<'all' | 'income' | 'expense'>('all');
  const [transactionStatus, setTransactionStatus] = useState<PaymentStatus | 'all'>('all');
  const [appointmentDialog, setAppointmentDialog] = useState<AppointmentDialogState | null>(null);
  const [transactionDialog, setTransactionDialog] = useState<'income' | 'expense' | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<CalendarEvent | null>(null);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingRecurring, setSubmittingRecurring] = useState(false);

  const formatMoney = (amount: number) => new Intl.NumberFormat(displayLocale, { style: 'currency', currency }).format(amount);
  const monthLabel = calendarDate.toLocaleDateString(displayLocale, { month: 'long', year: 'numeric' });

  const refreshEvents = async () => {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const year = calendarDate.getFullYear();
      const month = calendarDate.getMonth() + 1;
      const response = await apiFetch(`/api/google-calendar/upcoming-events?year=${year}&month=${month}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiError(data, 'Não foi possível carregar a agenda.'));
      setEvents(data?.events || []);
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'Não foi possível carregar a agenda.');
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (view !== 'agenda') {
      setLoadingEvents(false);
      return;
    }
    refreshEvents();
  }, [view, calendarDate.getFullYear(), calendarDate.getMonth()]);

  const financial = useMemo(() => summarizeFinancialTransactions(transactions, period), [transactions, period]);
  const visibleTransactions = useMemo(() => financial.scoped.filter((transaction) => {
    const entryType = transaction.entryType || 'income';
    return (transactionType === 'all' || entryType === transactionType) && (transactionStatus === 'all' || transaction.status === transactionStatus);
  }), [financial.scoped, transactionStatus, transactionType]);

  const todayAppointments = events.filter((event) => {
    const eventDate = new Date(event.startIso);
    const today = new Date();
    return eventDate.getFullYear() === today.getFullYear() && eventDate.getMonth() === today.getMonth() && eventDate.getDate() === today.getDate() && !event.completed;
  });
  const nextAppointments = events.filter((event) => new Date(event.startIso).getTime() >= Date.now() && !event.completed).sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso)).slice(0, 5);
  const pendingAppointments = events.filter((event) => (
    // Compromisso ainda não concluído: pendência normal de confirmação/pagamento.
    // Compromisso já concluído: só volta pra fila se sobrou cobrança em aberto
    // (revisão pós-atendimento — mesma prioridade do mapa de processos da Agenda).
    event.completed
      ? financialModuleEnabled && event.payment != null && event.payment.status !== 'pago'
      : !financialModuleEnabled || !event.payment || event.payment.status !== 'pago'
  )).sort((a, b) => {
    const aPendingPayment = a.payment?.status === 'atrasado' ? 0 : a.payment?.status === 'pendente' ? 1 : 2;
    const bPendingPayment = b.payment?.status === 'atrasado' ? 0 : b.payment?.status === 'pendente' ? 1 : 2;
    return aPendingPayment - bPendingPayment || Date.parse(a.startIso) - Date.parse(b.startIso);
  }).slice(0, 12);
  const hasOperationalData = view === 'agenda' ? events.length > 0 : transactions.length > 0;

  const changeMonth = (offset: number) => {
    setCalendarDate((date) => {
      const nextMonth = new Date(date.getFullYear(), date.getMonth() + offset, 1);
      const today = new Date();
      const nextSelection = today.getFullYear() === nextMonth.getFullYear() && today.getMonth() === nextMonth.getMonth()
        ? dateInputValue(today)
        : dateInputValue(nextMonth);
      setSelectedDate(nextSelection);
      return nextMonth;
    });
  };

  const callEventAction = async (url: string, method: string, body?: object) => {
    const response = await apiFetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiError(data, 'Não foi possível atualizar o agendamento.'));
    await refreshEvents();
  };

  const saveAppointment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const service = String(form.get('service') || '').trim();
    const date = String(form.get('date') || '');
    const time = String(form.get('time') || '');
    const clientId = String(form.get('clientId') || '');
    const clientName = String(form.get('clientName') || '').trim();
    const clientPhone = String(form.get('clientPhone') || '').trim();
    const amount = Number(form.get('amount') || 0);
    const source = String(form.get('source') || 'unknown');
    if (!service || !date || !time) return;
    const selectedLead = leads.find((lead) => lead.id === clientId);
    const phone = selectedLead?.phone || clientPhone;
    if (!phone) {
      onToast('Informe um cliente do CRM ou um telefone para criar o agendamento.');
      return;
    }
    const prefix = source === 'ads' ? '[Ads] ' : source === 'referral' ? '[Indicação] ' : source === 'organic' ? '[Orgânico] ' : '[?] ';
    const summary = `${prefix}${service}`;
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setSubmitting(true);
    try {
      if (appointmentDialog?.mode === 'edit' && appointmentDialog.event) {
        const existing = appointmentDialog.event;
        await callEventAction(`/api/google-calendar/events/${encodeURIComponent(existing.id)}`, 'PATCH', { summary });
        const oldStart = new Date(existing.startIso);
        if (oldStart.getTime() !== start.getTime()) {
          await callEventAction(`/api/google-calendar/events/${encodeURIComponent(existing.id)}/reschedule`, 'PATCH', { newStartIso: start.toISOString(), newEndIso: end.toISOString() });
        }
        onToast('Agendamento atualizado e agenda sincronizada.');
      } else {
        const response = await apiFetch(`/api/conversations/${encodeURIComponent(phone)}/manual-appointment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceName: summary,
            startIso: start.toISOString().slice(0, 19),
            endIso: end.toISOString().slice(0, 19),
            notes: clientName ? `Cliente informado na central: ${clientName}` : undefined,
            ...(financialModuleEnabled && Number.isFinite(amount) && amount >= 0 ? { amount } : {}),
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getApiError(data, 'Não foi possível criar o agendamento.'));
        onToast(financialModuleEnabled ? 'Agendamento criado e cobrança pendente vinculada automaticamente.' : 'Agendamento criado na agenda.');
      }
      setAppointmentDialog(null);
      await refreshEvents();
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível salvar o agendamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!transactionDialog) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount') || 0);
    const description = String(form.get('description') || '').trim();
    const clientId = String(form.get('clientId') || '');
    const selectedLead = leads.find((lead) => lead.id === clientId);
    if (!description || !Number.isFinite(amount) || amount <= 0) return;
    setSubmitting(true);
    const isExpense = transactionDialog === 'expense';
    const created = await onAddTransaction({
      id: crypto.randomUUID(),
      leadId: isExpense ? 'business-expense' : selectedLead?.id || 'manual-income',
      leadName: isExpense ? 'Negócio' : selectedLead?.name || 'Cliente sem cadastro',
      leadPhone: isExpense ? 'interno' : selectedLead?.phone || 'não informado',
      productName: description,
      amount,
      paymentMethod: String(form.get('paymentMethod') || 'Transferência Bancária') as PaymentMethod,
      status: String(form.get('status') || 'pago') as PaymentStatus,
      date: new Date().toISOString(),
      operatorName: currentUser.name,
      channel: isExpense ? 'Despesa operacional' : 'Receita manual',
      entryType: isExpense ? 'expense' : 'income',
    });
    setSubmitting(false);
    if (created) {
      setTransactionDialog(null);
      onToast(isExpense ? 'Despesa registrada no financeiro.' : 'Receita manual registrada no financeiro.');
    }
  };

  const savePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentDialog) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount') || 0);
    setSubmitting(true);
    try {
      const payload = {
        amount,
        paymentMethod: String(form.get('paymentMethod')),
        status: String(form.get('status')),
      };
      await callEventAction(`/api/google-calendar/events/${encodeURIComponent(paymentDialog.id)}/payment`, paymentDialog.payment ? 'PATCH' : 'POST', payload);
      setPaymentDialog(null);
      onToast('Cobrança do agendamento atualizada sem lançamento duplicado.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível atualizar a cobrança.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeleteTransaction = (transaction: FinancialTransaction) => {
    const label = transaction.productName || (isSpanish ? 'este registro' : 'este lançamento');
    if (window.confirm(isSpanish ? `¿Eliminar “${label}”? Esta acción no se puede deshacer.` : `Excluir “${label}”? Esta ação não pode ser desfeita.`)) {
      onDeleteTransaction(transaction.id);
    }
  };

  const saveRecurringExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAddRecurringExpense) return;
    const form = new FormData(event.currentTarget);
    const description = String(form.get('description') || '').trim();
    const amount = Number(form.get('amount') || 0);
    const dayOfMonth = Number(form.get('dayOfMonth') || 0);
    if (!description || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) return;
    setSubmittingRecurring(true);
    const created = await onAddRecurringExpense({
      description,
      amount,
      paymentMethod: String(form.get('paymentMethod') || 'Transferência Bancária') as PaymentMethod,
      dayOfMonth,
    });
    setSubmittingRecurring(false);
    if (created) setRecurringDialogOpen(false);
  };

  const confirmDeleteRecurringExpense = (expense: RecurringExpense) => {
    if (!onDeleteRecurringExpense) return;
    if (window.confirm(isSpanish ? `¿Eliminar el gasto recurrente “${expense.description}”? Esta acción no se puede deshacer.` : `Excluir a despesa recorrente “${expense.description}”? Esta ação não pode ser desfeita.`)) {
      onDeleteRecurringExpense(expense.id);
    }
  };

  const quickComplete = async (calendarEvent: CalendarEvent) => {
    try {
      await callEventAction(`/api/google-calendar/events/${encodeURIComponent(calendarEvent.id)}/complete`, 'POST', { completed: !calendarEvent.completed });
      onToast(calendarEvent.completed ? 'Atendimento reaberto.' : 'Atendimento marcado como concluído.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível atualizar o atendimento.');
    }
  };

  const cancelAppointment = async (calendarEvent: CalendarEvent) => {
    if (!window.confirm(`Cancelar “${calendarEvent.summary}”? O evento será removido da agenda real.`)) return;
    try {
      await callEventAction(`/api/google-calendar/events/${encodeURIComponent(calendarEvent.id)}`, 'DELETE');
      onToast('Agendamento cancelado e removido da agenda.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível cancelar o agendamento.');
    }
  };

  const eventDays = useMemo(() => {
    const daysInMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), index + 1);
      const appointments = events.filter((calendarEvent) => {
        const eventDate = new Date(calendarEvent.startIso);
        return eventDate.getFullYear() === day.getFullYear() && eventDate.getMonth() === day.getMonth() && eventDate.getDate() === day.getDate();
      });
      return { day, appointments };
    });
  }, [calendarDate, events]);

  const goToToday = () => {
    const today = new Date();
    setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(dateInputValue(today));
  };

  const EventCard = ({ calendarEvent, compact = false }: { calendarEvent: CalendarEvent; compact?: boolean }) => (
    <article className={`group rounded-2xl border border-slate-800 bg-slate-950/55 p-${compact ? '3' : '4'} transition-colors hover:border-emerald-500/35`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
          <span className="text-[10px] font-bold uppercase">{new Date(calendarEvent.startIso).toLocaleDateString(displayLocale, { weekday: 'short' }).replace('.', '')}</span>
          <span className="text-sm font-black leading-none">{new Date(calendarEvent.startIso).getDate()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">{calendarEvent.summary}</h3>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />{new Date(calendarEvent.startIso).toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' })}{calendarEvent.endIso ? ` — ${new Date(calendarEvent.endIso).toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
            </div>
            {calendarEvent.completed && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {financialModuleEnabled && (calendarEvent.payment ? <button type="button" onClick={() => setPaymentDialog(calendarEvent)} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusStyle[calendarEvent.payment.status]}`}>{calendarEvent.payment.status === 'pago' ? (isSpanish ? 'Cobrado' : 'Recebido') : calendarEvent.payment.status === 'atrasado' ? (isSpanish ? 'Atrasado' : 'Em atraso') : (isSpanish ? 'Por cobrar' : 'A receber')} · {formatMoney(calendarEvent.payment.amount)}</button> : <button type="button" onClick={() => setPaymentDialog(calendarEvent)} className="rounded-full border border-dashed border-amber-500/35 px-2 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-500/10">{isSpanish ? 'Vincular cobro' : 'Vincular cobrança'}</button>)}
            {!compact && <div className="ml-auto flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
              <button type="button" onClick={() => setAppointmentDialog({ mode: 'edit', event: calendarEvent })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" title={isSpanish ? 'Editar agendamiento' : 'Editar agendamento'}><MoreHorizontal className="h-4 w-4" /></button>
              <button type="button" onClick={() => quickComplete(calendarEvent)} className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-300" title={isSpanish ? 'Finalizar atención' : 'Concluir atendimento'}><CheckCircle2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => cancelAppointment(calendarEvent)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300" title={isSpanish ? 'Cancelar agendamiento' : 'Cancelar agendamento'}><Trash2 className="h-4 w-4" /></button>
            </div>}
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div className={`agenda-financeiro-workspace agenda-financeiro-workspace--${view} agenda-financeiro-workspace--financial-detail-${mobileDetail || 'closed'} agenda-financeiro-workspace--agenda-mobile-${mobileAgendaView} space-y-5 animate-page-enter`}>
      <section className="agenda-financeiro-workspace__hero operations-hero overflow-hidden rounded-3xl border p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.17em] text-emerald-300"><span className="h-px w-7 bg-emerald-400" />{view === 'agenda' ? (isSpanish ? 'Operación comercial' : 'Operação comercial') : (isSpanish ? 'Control de caja' : 'Controle de caixa')}</div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{view === 'agenda' ? 'Agenda' : (isSpanish ? 'Finanzas' : 'Financeiro')}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{view === 'agenda' ? (financialModuleEnabled ? (isSpanish ? 'Organizá horarios, acompañá los próximos atendimientos y registrá cobros vinculados a cada cita.' : 'Organize horários, acompanhe os próximos atendimentos e registre cobranças vinculadas a cada agendamento.') : (isSpanish ? 'Organizá horarios y acompañá los próximos atendimientos en una rutina independiente.' : 'Organize horários e acompanhe os próximos atendimentos em uma rotina independente.')) : (isSpanish ? 'Acompañá ingresos, gastos y cobros pendientes sin mezclar esta rutina con la agenda.' : 'Acompanhe receitas, despesas e cobranças em aberto sem misturar essa rotina com a agenda.')}</p>
          </div>
          <div className="agenda-financeiro-workspace__actions flex flex-wrap gap-2">
            {view === 'financial' && <><button type="button" onClick={() => setTransactionDialog('expense')} className="rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2.5 text-xs font-bold text-slate-200 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10"><ArrowDownRight className="mr-1.5 inline h-4 w-4 text-rose-300" />{isSpanish ? 'Nuevo gasto' : 'Nova despesa'}</button><button type="button" onClick={() => setTransactionDialog('income')} className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-500/15"><ArrowUpRight className="mr-1.5 inline h-4 w-4" />{isSpanish ? 'Ingreso adicional' : 'Receita avulsa'}</button></>}
            {view === 'agenda' && <button type="button" onClick={() => setAppointmentDialog({ mode: 'new' })} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition-transform active:scale-[0.98]"><Plus className="mr-1.5 inline h-4 w-4" />{isSpanish ? 'Nuevo agendamiento' : 'Novo agendamento'}</button>}
          </div>
        </div>
      </section>

      {view === 'agenda' ? <section className="agenda-financeiro-workspace__metrics grid grid-cols-1 gap-3 sm:grid-cols-2"><Metric icon={<CalendarDays className="h-4 w-4" />} label={isSpanish ? 'Agendamientos de hoy' : 'Agendamentos hoje'} value={String(todayAppointments.length)} note={todayAppointments.length ? (isSpanish ? `${todayAppointments.filter((event) => event.payment?.status !== 'pago').length} esperando registro` : `${todayAppointments.filter((event) => event.payment?.status !== 'pago').length} aguardando baixa`) : (isSpanish ? 'No hay atenciones en la agenda' : 'Nenhum atendimento na agenda')} tone="emerald" /><Metric icon={<Clock3 className="h-4 w-4" />} label={isSpanish ? 'Próximos atendimientos' : 'Próximos atendimentos'} value={String(nextAppointments.length)} note={nextAppointments.length ? (isSpanish ? 'Citas futuras en el calendario' : 'Compromissos futuros no calendário') : (isSpanish ? 'No hay próximos compromisos' : 'Nenhum próximo compromisso')} tone="blue" /></section> : <section className="agenda-financeiro-workspace__metrics grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<ArrowUpRight className="h-4 w-4" />} label={isSpanish ? 'Cobrado en el período' : 'Recebido no período'} value={formatMoney(financial.received)} note={period === 'month' ? (isSpanish ? 'Ingresos confirmados del mes' : 'Receitas confirmadas no mês') : (isSpanish ? 'Todos los ingresos confirmados' : 'Todas as receitas confirmadas')} tone="emerald" /><Metric icon={<AlertCircle className="h-4 w-4" />} label={isSpanish ? 'Pendiente' : 'Em aberto'} value={formatMoney(financial.open)} note={financial.overdue ? (isSpanish ? `${formatMoney(financial.overdue)} atrasado` : `${formatMoney(financial.overdue)} em atraso`) : (isSpanish ? 'No hay cobros atrasados' : 'Nenhuma cobrança atrasada')} tone="amber" /><Metric icon={<WalletCards className="h-4 w-4" />} label={isSpanish ? 'Resultado neto' : 'Resultado líquido'} value={formatMoney(financial.net)} note={isSpanish ? `${formatMoney(financial.spent)} en gastos del período` : `${formatMoney(financial.spent)} em despesas no período`} tone={financial.net >= 0 ? 'blue' : 'rose'} /></section>}

      {!hasOperationalData && !loadingEvents && <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-6 text-center"><CircleDollarSign className="mx-auto h-7 w-7 text-emerald-400" /><h2 className="mt-3 font-bold text-white">{view === 'agenda' ? (isSpanish ? 'La agenda está lista para recibir atenciones' : 'A agenda está pronta para receber atendimentos') : (isSpanish ? 'El financiero está listo para recibir registros' : 'O financeiro está pronto para receber lançamentos')}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{view === 'agenda' ? (isSpanish ? 'Todavía no hay compromisos en este período. Creá el primer agendamiento o esperá la próxima reserva del agente.' : 'Ainda não há compromissos neste período. Crie o primeiro agendamento ou aguarde a próxima reserva do agente.') : (isSpanish ? 'Todavía no hay ingresos ni gastos registrados en este período.' : 'Ainda não há receitas ou despesas registradas neste período.')}</p></section>}

      {view === 'agenda' && <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 shadow-lg sm:p-5">
          {/* Achado real (26/08/2026 e 28/08/2026, pedidos do dono do produto
              com print): o nav de mês e o banner "Dia selecionado" mostravam
              a mesma informação duas vezes, em dois blocos empilhados —
              fundidos num único cartão (26/08). No celular real, ainda assim
              quebrava em 3 linhas por causa do texto do dia selecionado por
              extenso; removido (28/08) — a mesma informação já aparece no
              anel de destaque e no selo de contagem do dia na grade logo
              abaixo, então o cabeçalho agora é só: nav de mês + "Ir para
              hoje", garantido numa linha só mesmo em tela estreita. */}
          <div className="mb-3">
            <h2 className="font-bold text-white">{isSpanish ? 'Agenda operativa' : 'Agenda operacional'}</h2>
            <p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Eventos reales del calendario, cobro y atención en el mismo flujo.' : 'Eventos reais do calendário, cobrança e atendimento no mesmo fluxo.'}</p>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <button onClick={() => changeMonth(-1)} className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={isSpanish ? 'Mes anterior' : 'Mês anterior'}><ChevronLeft className="h-4 w-4" /></button>
              {/* Achado real (28/08/2026, pedido do dono do produto com print): com
                  o dia selecionado + contagem de compromissos aqui, o cabeçalho
                  quebrava em 3 linhas num celular real (mês, dia por extenso,
                  botão) — a mesma informação já aparece no anel de destaque e no
                  selo de contagem da célula do dia logo abaixo, então tirar daqui
                  não perde nada e deixa a linha inteira num só nível. */}
              <p className="min-w-0 truncate px-1 text-xs font-bold capitalize text-slate-200">{monthLabel}</p>
              <button onClick={() => changeMonth(1)} className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={isSpanish ? 'Mes siguiente' : 'Próximo mês'}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={goToToday} className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/15">{isSpanish ? 'Ir a hoy' : 'Ir para hoje'}</button>
          </div>

          {loadingEvents ? <div className="grid grid-cols-7 gap-1.5 animate-pulse sm:gap-2">{Array.from({ length: 28 }, (_, index) => <div key={index} className="h-14 rounded-xl bg-slate-800/70 sm:h-16" />)}</div> : eventsError ? <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"><p>{eventsError}</p><button onClick={refreshEvents} className="mt-2 text-xs font-bold underline">{isSpanish ? 'Intentar nuevamente' : 'Tentar novamente'}</button></div> : <div className="grid grid-cols-7 gap-1 sm:gap-1.5"><div className="col-span-7 grid grid-cols-7 gap-1 pb-1 text-center text-[9px] font-bold uppercase tracking-wider text-slate-500 sm:gap-1.5 sm:text-[10px]">{(isSpanish ? ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']).map((day) => <span key={day}>{day}</span>)}</div>{Array.from({ length: (calendarDate.getDay() + 6) % 7 }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" className="min-h-14 sm:min-h-16" />)}{eventDays.map(({ day, appointments }) => {
                const dayKey = dateInputValue(day);
                const isToday = dayKey === dateInputValue(new Date());
                const isSelected = dayKey === selectedDate;
                return (
                  <button
                    type="button"
                    key={day.toISOString()}
                    onClick={() => {
                      setSelectedDate(dayKey);
                      // Achado real (28/08/2026, pedido do dono do produto com print):
                      // antes, tocar em QUALQUER dia sempre abria "Novo agendamento" —
                      // até num dia que já tinha compromisso, o preview de horário
                      // dentro da célula não levava a lugar nenhum de útil. Agora: dia
                      // vazio abre criação (comportamento de sempre); dia com só 1
                      // compromisso abre a edição DELE; dia com 2+ só seleciona (evita
                      // abrir o compromisso errado sem o operador escolher qual).
                      if (appointments.length === 0) setAppointmentDialog({ mode: 'new', initialDate: dayKey });
                      else if (appointments.length === 1) setAppointmentDialog({ mode: 'edit', event: appointments[0] });
                    }}
                    aria-label={`${isToday ? (isSpanish ? 'Hoy, ' : 'Hoje, ') : ''}${day.getDate()} ${monthLabel}${appointments.length ? ` · ${appointments.length} ${isSpanish ? 'citas' : 'compromissos'}` : ''}`}
                    aria-pressed={isSelected}
                    className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border p-1 transition-colors sm:min-h-16 sm:rounded-xl sm:p-1.5 ${isSelected ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/45' : appointments.length ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}
                  >
                    <span className={`flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold ${isToday ? 'bg-emerald-400 px-1 text-slate-950' : isSelected ? 'bg-emerald-500/15 px-1 text-emerald-200' : 'text-slate-300'}`}>{day.getDate()}</span>
                    {appointments.length > 0 && <span className="rounded-full bg-emerald-400 px-1.5 text-[8px] font-black text-slate-950">{appointments.length}</span>}
                  </button>
                );
              })}</div>}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-lg"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-white">{isSpanish ? 'Próximos compromisos' : 'Próximos compromissos'}</h2><p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Acciones que requieren atención a continuación.' : 'Ações que exigem atenção na sequência.'}</p></div><button type="button" onClick={refreshEvents} className="text-xs font-bold text-emerald-300 hover:text-emerald-200">{isSpanish ? 'Actualizar' : 'Atualizar'}</button></div><div className="space-y-3">{nextAppointments.length ? nextAppointments.map((event) => <div key={event.id}><EventCard calendarEvent={event} compact /></div>) : <p className="rounded-xl bg-slate-950/55 p-4 text-center text-xs text-slate-500">{isSpanish ? 'No se encontraron compromisos futuros este mes.' : 'Nenhum compromisso futuro encontrado neste mês.'}</p>}</div></div>
      </section>}

      {view === 'agenda' && <section className="agenda-financeiro-workspace__pending rounded-2xl border border-slate-800 bg-slate-900/75 p-4 shadow-lg sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{isSpanish ? 'Decisión requerida' : 'Decisão necessária'}</p><h2 className="mt-1 font-bold text-white">{isSpanish ? 'Pendientes de la agenda' : 'Pendências da agenda'}</h2><p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Confirmación y cobro antes de seguir con la atención.' : 'Confirmação e cobrança antes de seguir com o atendimento.'}</p></div><span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-200">{pendingAppointments.length}</span></div>
        {pendingAppointments.length ? <div className="space-y-2">{pendingAppointments.map((event) => <div key={event.id}><EventCard calendarEvent={event} compact /></div>)}</div> : <div className="rounded-xl border border-dashed border-slate-700 px-3 py-8 text-center text-xs text-slate-400">{isSpanish ? 'No hay pendientes para revisar.' : 'Nenhuma pendência para revisar.'}</div>}
      </section>}

      {view === 'financial' &&<section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-lg"><div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="font-bold text-white">{isSpanish ? 'Flujo financiero' : 'Fluxo financeiro'}</h2><p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Ingresos vinculados a la agenda, registros manuales y gastos operativos.' : 'Receitas vinculadas à agenda, lançamentos manuais e despesas operacionais.'}</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value as 'month' | 'all')} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200"><option value="month">{isSpanish ? 'Mes actual' : 'Mês atual'}</option><option value="all">{isSpanish ? 'Todo el historial' : 'Todo histórico'}</option></select><select value={transactionType} onChange={(event) => setTransactionType(event.target.value as 'all' | 'income' | 'expense')} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200"><option value="all">{isSpanish ? 'Todos los tipos' : 'Todos os tipos'}</option><option value="income">{isSpanish ? 'Ingresos' : 'Receitas'}</option><option value="expense">{isSpanish ? 'Gastos' : 'Despesas'}</option></select><select value={transactionStatus} onChange={(event) => setTransactionStatus(event.target.value as PaymentStatus | 'all')} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200"><option value="all">{isSpanish ? 'Todos los estados' : 'Todos os status'}</option>{(['pago', 'pendente', 'atrasado', 'cancelado'] as PaymentStatus[]).map((status) => <option key={status} value={status}>{transactionStatusLabel(status, isSpanish)}</option>)}</select><button type="button" onClick={() => setTransactionDialog('income')} className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/15"><Plus className="mr-1 inline h-3.5 w-3.5" />{isSpanish ? 'Ingreso adicional' : 'Receita avulsa'}</button></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-slate-950/45 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{isSpanish ? 'Previsto' : 'Previsto'}</p><p className="mt-1 text-sm font-black text-slate-200">{formatMoney(financial.projectedIncome)}</p></div><div className="rounded-xl bg-slate-950/45 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{isSpanish ? 'Ingresos' : 'Receitas'}</p><p className="mt-1 text-sm font-black text-emerald-300">{financial.incomeCount}</p></div><div className="rounded-xl bg-slate-950/45 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{isSpanish ? 'Por cobrar' : 'A receber'}</p><p className="mt-1 text-sm font-black text-amber-200">{financial.pendingCount}</p></div><div className="rounded-xl bg-slate-950/45 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{isSpanish ? 'Cobrado' : 'Recebido'}</p><p className="mt-1 text-sm font-black text-sky-200">{financial.collectionRate === null ? '—' : new Intl.NumberFormat(displayLocale, { style: 'percent', maximumFractionDigits: 0 }).format(financial.collectionRate)}</p></div></div><div className="responsive-table-scroll hidden overflow-x-auto sm:block"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-3 font-bold">{isSpanish ? 'Fecha' : 'Data'}</th><th className="pb-3 font-bold">{isSpanish ? 'Cliente / descripción' : 'Cliente / descrição'}</th><th className="pb-3 font-bold">{isSpanish ? 'Tipo' : 'Tipo'}</th><th className="pb-3 font-bold">{isSpanish ? 'Estado' : 'Status'}</th><th className="pb-3 text-right font-bold">{isSpanish ? 'Valor' : 'Valor'}</th><th className="pb-3" /></tr></thead><tbody className="divide-y divide-slate-800/80">{visibleTransactions.length ? visibleTransactions.map((transaction) => <tr key={transaction.id} className="transition-colors hover:bg-slate-800/30"><td className="py-3.5 text-slate-400">{new Date(transaction.date).toLocaleDateString(displayLocale)}</td><td className="py-3.5"><p className="font-bold text-slate-200">{transaction.productName}</p><p className="mt-0.5 text-[10px] text-slate-500">{transaction.entryType === 'expense' ? (isSpanish ? 'Gasto operativo' : 'Despesa operacional') : transaction.leadName}</p></td><td className="py-3.5"><span className={`inline-flex items-center gap-1 font-bold ${transaction.entryType === 'expense' ? 'text-rose-300' : 'text-emerald-300'}`}>{transaction.entryType === 'expense' ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{transaction.entryType === 'expense' ? (isSpanish ? 'Gasto' : 'Despesa') : (isSpanish ? 'Ingreso' : 'Receita')}</span></td><td className="py-3.5"><select value={transaction.status} onChange={(event) => onUpdateTransactionStatus(transaction.id, event.target.value as PaymentStatus)} aria-label={`${isSpanish ? 'Estado de' : 'Status de'} ${transaction.productName}`} className={`rounded-full border px-2 py-1 text-[10px] font-bold outline-none ${statusStyle[transaction.status]}`}>{(['pago', 'pendente', 'atrasado', 'cancelado'] as PaymentStatus[]).map((status) => <option key={status} value={status}>{transactionStatusLabel(status, isSpanish)}</option>)}</select></td><td className={`py-3.5 text-right font-black ${transaction.entryType === 'expense' ? 'text-rose-300' : 'text-emerald-300'}`}>{transaction.entryType === 'expense' ? '-' : '+'}{formatMoney(transaction.amount)}</td><td className="py-3.5 text-right"><button type="button" onClick={() => confirmDeleteTransaction(transaction)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title={isSpanish ? 'Eliminar registro' : 'Excluir lançamento'}><Trash2 className="h-3.5 w-3.5" /></button></td></tr>) : <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-500">{isSpanish ? 'Todavía no hay registros reales para este filtro.' : 'Ainda não há lançamentos reais para este filtro.'}</td></tr>}</tbody></table></div><div className="space-y-2 sm:hidden">{visibleTransactions.length ? visibleTransactions.map((transaction) => <div key={transaction.id}><FinancialTransactionCard transaction={transaction} currency={currency} displayLocale={displayLocale} isSpanish={isSpanish} onUpdateStatus={onUpdateTransactionStatus} onDelete={() => confirmDeleteTransaction(transaction)} /></div>) : <p className="rounded-xl bg-slate-950/55 p-4 text-center text-xs text-slate-500">{isSpanish ? 'Todavía no hay registros reales para este filtro.' : 'Ainda não há lançamentos reais para este filtro.'}</p>}</div></section>}

      {view === 'financial' && onAddRecurringExpense && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-lg">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-white"><Repeat className="h-4 w-4 text-emerald-300" />{isSpanish ? 'Gastos recurrentes' : 'Despesas recorrentes'}</h2>
              <p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Gastos fijos (alquiler, suscripciones...) que se lanzan solos todo mes en el día de vencimiento — sin volver a escribirlos.' : 'Despesas fixas (aluguel, assinaturas...) que se lançam sozinhas todo mês no dia de vencimento — sem precisar digitar de novo.'}</p>
            </div>
            <button type="button" onClick={() => setRecurringDialogOpen(true)} className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/15">
              <Plus className="mr-1 inline h-3.5 w-3.5" />{isSpanish ? 'Nuevo gasto recurrente' : 'Nova despesa recorrente'}
            </button>
          </div>

          {recurringExpenses.length === 0 ? (
            <p className="rounded-xl bg-slate-950/55 p-4 text-center text-xs text-slate-500">{isSpanish ? 'Todavía no hay gastos recurrentes cadastrados.' : 'Ainda não há despesas recorrentes cadastradas.'}</p>
          ) : (
            <div className="space-y-2">
              {recurringExpenses.map((expense) => (
                <div key={expense.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${expense.active ? 'border-slate-800 bg-slate-950/55' : 'border-slate-800/60 bg-slate-950/30 opacity-60'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-200">{expense.description}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {isSpanish ? `Vence el día ${expense.dayOfMonth} de cada mes · ${expense.paymentMethod}` : `Vence todo dia ${expense.dayOfMonth} · ${expense.paymentMethod}`}
                      {expense.lastGeneratedMonth ? ` · ${isSpanish ? 'último lanzamiento' : 'último lançamento'}: ${expense.lastGeneratedMonth}` : ''}
                      {!expense.active ? ` · ${isSpanish ? 'pausado' : 'pausado'}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-black text-rose-300">{formatMoney(expense.amount)}</span>
                    {onToggleRecurringExpense && (
                      <button type="button" onClick={() => onToggleRecurringExpense(expense.id, !expense.active)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" title={expense.active ? (isSpanish ? 'Pausar' : 'Pausar') : (isSpanish ? 'Retomar' : 'Retomar')}>
                        {expense.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                    )}
                    {onDeleteRecurringExpense && (
                      <button type="button" onClick={() => confirmDeleteRecurringExpense(expense)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title={isSpanish ? 'Eliminar' : 'Excluir'}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {appointmentDialog && <AppointmentDialog dialog={appointmentDialog} leads={leads} currency={currency} isSpanish={isSpanish} onClose={() => setAppointmentDialog(null)} onSubmit={saveAppointment} submitting={submitting} />}
      {transactionDialog && <TransactionDialog kind={transactionDialog} leads={leads} currency={currency} isSpanish={isSpanish} onClose={() => setTransactionDialog(null)} onSubmit={saveTransaction} submitting={submitting} />}
      {paymentDialog && <PaymentDialog event={paymentDialog} currency={currency} isSpanish={isSpanish} onClose={() => setPaymentDialog(null)} onSubmit={savePayment} submitting={submitting} />}
      {recurringDialogOpen && <RecurringExpenseDialog currency={currency} isSpanish={isSpanish} onClose={() => setRecurringDialogOpen(false)} onSubmit={saveRecurringExpense} submitting={submittingRecurring} />}
    </div>
  );
};

function transactionStatusLabel(status: PaymentStatus, isSpanish: boolean) {
  const labels: Record<PaymentStatus, { pt: string; es: string }> = {
    pago: { pt: 'Recebido', es: 'Cobrado' },
    pendente: { pt: 'A receber', es: 'Por cobrar' },
    atrasado: { pt: 'Em atraso', es: 'Atrasado' },
    cancelado: { pt: 'Cancelado', es: 'Cancelado' },
  };
  return labels[status][isSpanish ? 'es' : 'pt'];
}

function FinancialTransactionCard({ transaction, currency, displayLocale, isSpanish, onUpdateStatus, onDelete }: { transaction: FinancialTransaction; currency: string; displayLocale: string; isSpanish: boolean; onUpdateStatus: (id: string, status: PaymentStatus) => void; onDelete: (id: string) => void }) {
  const isExpense = transaction.entryType === 'expense';
  const formatMoney = (amount: number) => new Intl.NumberFormat(displayLocale, { style: 'currency', currency }).format(amount);
  return <article className="rounded-xl bg-slate-950/55 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-200">{transaction.productName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{isExpense ? (isSpanish ? 'Gasto operativo' : 'Despesa operacional') : transaction.leadName}</p></div><span className={`shrink-0 text-sm font-black ${isExpense ? 'text-rose-300' : 'text-emerald-300'}`}>{isExpense ? '-' : '+'}{formatMoney(transaction.amount)}</span></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{new Date(transaction.date).toLocaleDateString(displayLocale)} · {isExpense ? (isSpanish ? 'Gasto' : 'Despesa') : (isSpanish ? 'Ingreso' : 'Receita')}</span><select value={transaction.status} onChange={(event) => onUpdateStatus(transaction.id, event.target.value as PaymentStatus)} aria-label={`${isSpanish ? 'Estado de' : 'Status de'} ${transaction.productName}`} className={`rounded-full border bg-transparent px-2 py-1 text-[10px] font-bold outline-none ${statusStyle[transaction.status]}`}>{(['pago', 'pendente', 'atrasado', 'cancelado'] as PaymentStatus[]).map((status) => <option key={status} value={status}>{transactionStatusLabel(status, isSpanish)}</option>)}</select></div><button type="button" onClick={() => onDelete(transaction.id)} className="mt-2 rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title={isSpanish ? 'Eliminar registro' : 'Excluir lançamento'}><Trash2 className="h-3.5 w-3.5" /></button></article>;
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: 'emerald' | 'amber' | 'blue' | 'rose' }) {
  const tones = { emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', amber: 'bg-amber-400/10 text-amber-200 border-amber-400/20', blue: 'bg-sky-500/10 text-sky-200 border-sky-500/20', rose: 'bg-rose-500/10 text-rose-200 border-rose-500/20' };
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 shadow-lg"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-400">{label}</span><span className={`rounded-lg border p-2 ${tones[tone]}`}>{icon}</span></div><p className="mt-4 text-2xl font-black tracking-tight text-white">{value}</p><p className="mt-1 text-[11px] text-slate-500">{note}</p></article>;
}

function DialogShell({ title, description, children, onClose }: { title: string; description: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4"><div><h2 className="font-bold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{description}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>{children}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-slate-300"><span className="mb-1.5 block">{label}</span>{children}</label>; }
const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400';

function AppointmentDialog({ dialog, leads, currency, isSpanish, onClose, onSubmit, submitting }: { dialog: AppointmentDialogState; leads: LeadInfo[]; currency: string; isSpanish: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitting: boolean }) {
  const eventDate = dialog.event ? new Date(dialog.event.startIso) : dialog.initialDate ? new Date(`${dialog.initialDate}T12:00:00`) : new Date();
  const cleanSummary = dialog.event?.summary.replace(/^\[[^\]]+\]\s*/, '') || '';
  return <DialogShell title={dialog.mode === 'new' ? (isSpanish ? 'Nuevo agendamiento' : 'Novo agendamento') : (isSpanish ? 'Editar agendamiento' : 'Editar agendamento')} description={isSpanish ? 'El servicio, la agenda y el cobro quedan vinculados en el mismo flujo.' : 'O serviço, a agenda e a cobrança ficam vinculados ao mesmo fluxo.'} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4 pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label={isSpanish ? 'Cliente del CRM' : 'Cliente do CRM'}><select name="clientId" defaultValue="" className={inputClass} disabled={dialog.mode === 'edit'}><option value="">{isSpanish ? 'Seleccionar cliente' : 'Selecionar cliente'}</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.phone}</option>)}</select></Field><Field label={isSpanish ? 'Teléfono para cliente sin registro' : 'Telefone para cliente avulso'}><input name="clientPhone" disabled={dialog.mode === 'edit'} placeholder="Ej.: 595 981 123456" className={inputClass} /></Field></div><Field label={isSpanish ? 'Nombre de la clienta (opcional)' : 'Nome do cliente (opcional)'}><input name="clientName" placeholder={isSpanish ? 'Usado para identificar el registro sin cuenta' : 'Usado para identificar o cadastro avulso'} className={inputClass} disabled={dialog.mode === 'edit'} /></Field><Field label={isSpanish ? 'Servicio' : 'Serviço'}><input name="service" required defaultValue={cleanSummary} placeholder={isSpanish ? 'Ej.: Diseño de cejas' : 'Ex.: Design de sobrancelhas'} className={inputClass} /></Field><div className="grid grid-cols-2 gap-4"><Field label={isSpanish ? 'Fecha' : 'Data'}><input name="date" type="date" required defaultValue={dateInputValue(eventDate)} className={inputClass} /></Field><Field label={isSpanish ? 'Hora' : 'Hora'}><input name="time" type="time" required defaultValue={timeInputValue(eventDate)} className={inputClass} /></Field></div><div className="grid grid-cols-2 gap-4"><Field label={`${isSpanish ? 'Valor del cobro' : 'Valor da cobrança'} (${currency})`}><input name="amount" type="number" min="0" step="0.01" defaultValue={dialog.event?.payment?.amount ?? ''} disabled={dialog.mode === 'edit'} placeholder="0" className={inputClass} /></Field><Field label={isSpanish ? 'Origen' : 'Origem'}><select name="source" defaultValue="unknown" className={inputClass}><option value="unknown">{isSpanish ? 'Sin origen identificado' : 'Sem origem identificada'}</option><option value="ads">Ads</option><option value="referral">{isSpanish ? 'Recomendación' : 'Indicação'}</option><option value="organic">{isSpanish ? 'Orgánico' : 'Orgânico'}</option></select></Field></div><button type="submit" disabled={submitting} className="w-full rounded-xl bg-emerald-400 py-3 text-xs font-black text-slate-950 transition-opacity disabled:opacity-50">{submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : dialog.mode === 'new' ? (isSpanish ? 'Crear agendamiento y cobro' : 'Criar agendamento e cobrança') : (isSpanish ? 'Guardar cambios' : 'Salvar alterações')}</button></form></DialogShell>;
}

function TransactionDialog({ kind, leads, currency, isSpanish, onClose, onSubmit, submitting }: { kind: 'income' | 'expense'; leads: LeadInfo[]; currency: string; isSpanish: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitting: boolean }) {
  const isExpense = kind === 'expense';
  const paymentLabel = (method: PaymentMethod) => isSpanish ? ({ 'Transferência Bancária': 'Transferencia bancaria', 'Cartão de Crédito': 'Tarjeta de crédito', 'Boleto Bancário': 'Boleta bancaria', 'Link WhatsApp': 'Enlace de WhatsApp', PIX: 'PIX' }[method] || method) : method;
  return <DialogShell title={isExpense ? (isSpanish ? 'Registrar gasto' : 'Registrar despesa') : (isSpanish ? 'Registrar ingreso adicional' : 'Registrar receita avulsa')} description={isExpense ? (isSpanish ? 'Registrá una salida operativa que no provino de un agendamiento.' : 'Controle uma saída operacional que não veio de um agendamento.') : (isSpanish ? 'Registrá un ingreso externo sin duplicar los cobros de la agenda.' : 'Registre uma receita externa sem duplicar cobranças da agenda.')} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4 pt-5">{!isExpense && <Field label={isSpanish ? 'Cliente del CRM' : 'Cliente do CRM'}><select name="clientId" defaultValue="" className={inputClass}><option value="">{isSpanish ? 'Cliente sin registro' : 'Cliente sem cadastro'}</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.phone}</option>)}</select></Field>}<Field label={isSpanish ? 'Descripción' : 'Descrição'}><input name="description" required placeholder={isExpense ? (isSpanish ? 'Ej.: Compra de materiales' : 'Ex.: Compra de materiais') : (isSpanish ? 'Ej.: Venta presencial' : 'Ex.: Venda presencial')} className={inputClass} /></Field><div className="grid grid-cols-2 gap-4"><Field label={`${isSpanish ? 'Valor' : 'Valor'} (${currency})`}><input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} /></Field><Field label={isSpanish ? 'Forma' : 'Forma'}><select name="paymentMethod" className={inputClass}>{PAYMENT_METHODS.map((method) => <option key={method}>{paymentLabel(method)}</option>)}</select></Field></div><Field label={isSpanish ? 'Estado' : 'Status'}><select name="status" defaultValue="pago" className={inputClass}><option value="pago">{isSpanish ? 'Cobrado / confirmado' : 'Pago / confirmado'}</option>{!isExpense && <option value="pendente">{isSpanish ? 'Pendiente' : 'Pendente'}</option>}</select></Field><button type="submit" disabled={submitting} className={`w-full rounded-xl py-3 text-xs font-black transition-opacity disabled:opacity-50 ${isExpense ? 'bg-rose-300 text-rose-950' : 'bg-emerald-400 text-slate-950'}`}>{submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : isExpense ? (isSpanish ? 'Registrar gasto' : 'Registrar despesa') : (isSpanish ? 'Registrar ingreso' : 'Registrar receita')}</button></form></DialogShell>;
}

function RecurringExpenseDialog({ currency, isSpanish, onClose, onSubmit, submitting }: { currency: string; isSpanish: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitting: boolean }) {
  const paymentLabel = (method: PaymentMethod) => isSpanish ? ({ 'Transferência Bancária': 'Transferencia bancaria', 'Cartão de Crédito': 'Tarjeta de crédito', 'Boleto Bancário': 'Boleta bancaria', 'Link WhatsApp': 'Enlace de WhatsApp', PIX: 'PIX' }[method] || method) : method;
  return <DialogShell title={isSpanish ? 'Nuevo gasto recurrente' : 'Nova despesa recorrente'} description={isSpanish ? 'Se lanza solo, todo mes, en el día elegido — no hace falta registrarlo de nuevo.' : 'Lança sozinha, todo mês, no dia escolhido — não precisa registrar de novo.'} onClose={onClose}>
    <form onSubmit={onSubmit} className="space-y-4 pt-5">
      <Field label={isSpanish ? 'Descripción' : 'Descrição'}><input name="description" required placeholder={isSpanish ? 'Ej.: Alquiler del local' : 'Ex.: Aluguel do salão'} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`${isSpanish ? 'Valor' : 'Valor'} (${currency})`}><input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} /></Field>
        <Field label={isSpanish ? 'Día de vencimiento' : 'Dia de vencimento'}><input name="dayOfMonth" type="number" min="1" max="28" required defaultValue="5" className={inputClass} /></Field>
      </div>
      <Field label={isSpanish ? 'Forma' : 'Forma'}><select name="paymentMethod" className={inputClass}>{PAYMENT_METHODS.map((method) => <option key={method}>{paymentLabel(method)}</option>)}</select></Field>
      <p className="text-[10px] leading-relaxed text-slate-500">{isSpanish ? 'Los días 29, 30 y 31 no están disponibles (algunos meses no los tienen) — el gasto se lanza como pagado en el día elegido.' : 'Os dias 29, 30 e 31 não estão disponíveis (nem todo mês tem) — a despesa é lançada como paga no dia escolhido.'}</p>
      <button type="submit" disabled={submitting} className="w-full rounded-xl bg-rose-300 py-3 text-xs font-black text-rose-950 transition-opacity disabled:opacity-50">{submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : (isSpanish ? 'Registrar gasto recurrente' : 'Registrar despesa recorrente')}</button>
    </form>
  </DialogShell>;
}

function PaymentDialog({ event, currency, isSpanish, onClose, onSubmit, submitting }: { event: CalendarEvent; currency: string; isSpanish: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitting: boolean }) { const paymentLabel = (method: PaymentMethod) => isSpanish ? ({ 'Transferência Bancária': 'Transferencia bancaria', 'Cartão de Crédito': 'Tarjeta de crédito', 'Boleto Bancário': 'Boleta bancaria', 'Link WhatsApp': 'Enlace de WhatsApp', PIX: 'PIX' }[method] || method) : method; return <DialogShell title={isSpanish ? 'Cobro del agendamiento' : 'Cobrança do agendamento'} description={isSpanish ? 'Este cobro usa la referencia del evento y se actualiza sin crear un registro duplicado.' : 'Esta cobrança usa a referência do evento e é atualizada sem criar um lançamento duplicado.'} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4 pt-5"><p className="rounded-xl bg-slate-950 p-3 text-sm font-bold text-white">{event.summary}</p><div className="grid grid-cols-2 gap-4"><Field label={`${isSpanish ? 'Valor' : 'Valor'} (${currency})`}><input name="amount" type="number" min="0" step="0.01" required defaultValue={event.payment?.amount ?? ''} className={inputClass} /></Field><Field label={isSpanish ? 'Forma' : 'Forma'}><select name="paymentMethod" defaultValue={event.payment?.paymentMethod || 'PIX'} className={inputClass}>{PAYMENT_METHODS.map((method) => <option key={method}>{paymentLabel(method)}</option>)}</select></Field></div><Field label={isSpanish ? 'Situación' : 'Situação'}><select name="status" defaultValue={event.payment?.status || 'pendente'} className={inputClass}><option value="pago">{isSpanish ? 'Cobrado' : 'Recebido'}</option><option value="pendente">{isSpanish ? 'Por cobrar' : 'A receber'}</option><option value="atrasado">{isSpanish ? 'Atrasado' : 'Em atraso'}</option><option value="cancelado">{isSpanish ? 'Cancelado' : 'Cancelado'}</option></select></Field><button type="submit" disabled={submitting} className="w-full rounded-xl bg-emerald-400 py-3 text-xs font-black text-slate-950 disabled:opacity-50">{submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : (isSpanish ? 'Guardar cobro' : 'Salvar cobrança')}</button></form></DialogShell>; }
