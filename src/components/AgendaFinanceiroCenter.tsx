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
  Plus,
  ReceiptText,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { summarizeFinancialTransactions } from '../lib/agendaFinanceiroMetrics';
import type { FinancialTransaction, LeadInfo, PaymentMethod, PaymentStatus, UserProfile } from '../types';
import { useAppPreferences } from '../contexts/AppPreferencesContext';

type CenterView = 'unified' | 'agenda' | 'financial';
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
  transactions: FinancialTransaction[];
  leads: LeadInfo[];
  currentUser: UserProfile;
  currency?: string;
  locale?: string;
  onAddTransaction: (transaction: FinancialTransaction) => Promise<boolean>;
  onUpdateTransactionStatus: (id: string, status: PaymentStatus) => Promise<void> | void;
  onDeleteTransaction: (id: string) => Promise<void> | void;
  onToast: (message: string) => void;
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
  transactions,
  leads,
  currentUser,
  currency = 'PYG',
  locale = 'es-PY',
  onAddTransaction,
  onUpdateTransactionStatus,
  onDeleteTransaction,
  onToast,
}) => {
  const { language } = useAppPreferences();
  const isSpanish = language === 'es';
  const displayLocale = isSpanish ? 'es-PY' : 'pt-BR';
  const [view, setView] = useState<CenterView>('unified');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [appointmentDialog, setAppointmentDialog] = useState<AppointmentDialogState | null>(null);
  const [transactionDialog, setTransactionDialog] = useState<'income' | 'expense' | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<CalendarEvent | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => { refreshEvents(); }, [calendarDate.getFullYear(), calendarDate.getMonth()]);

  const financial = useMemo(() => summarizeFinancialTransactions(transactions, period), [transactions, period]);

  const todayAppointments = events.filter((event) => {
    const eventDate = new Date(event.startIso);
    const today = new Date();
    return eventDate.getFullYear() === today.getFullYear() && eventDate.getMonth() === today.getMonth() && eventDate.getDate() === today.getDate() && !event.completed;
  });
  const nextAppointments = events.filter((event) => new Date(event.startIso).getTime() >= Date.now() && !event.completed).sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso)).slice(0, 5);
  const hasOperationalData = events.length > 0 || transactions.length > 0;

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
            amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getApiError(data, 'Não foi possível criar o agendamento.'));
        onToast('Agendamento criado e cobrança pendente vinculada automaticamente.');
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

  const selectedDateLabel = useMemo(() => new Intl.DateTimeFormat(displayLocale, {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${selectedDate}T12:00:00`)), [displayLocale, selectedDate]);

  const selectedDateEvents = useMemo(
    () => eventDays.find(({ day }) => dateInputValue(day) == selectedDate)?.appointments || [],
    [eventDays, selectedDate],
  );

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
            {calendarEvent.payment ? <button type="button" onClick={() => setPaymentDialog(calendarEvent)} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusStyle[calendarEvent.payment.status]}`}>{calendarEvent.payment.status === 'pago' ? (isSpanish ? 'Cobrado' : 'Recebido') : calendarEvent.payment.status === 'atrasado' ? (isSpanish ? 'Atrasado' : 'Em atraso') : (isSpanish ? 'Por cobrar' : 'A receber')} · {formatMoney(calendarEvent.payment.amount)}</button> : <button type="button" onClick={() => setPaymentDialog(calendarEvent)} className="rounded-full border border-dashed border-amber-500/35 px-2 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-500/10">{isSpanish ? 'Vincular cobro' : 'Vincular cobrança'}</button>}
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
    <div className="agenda-financeiro-workspace space-y-5 animate-page-enter">
      <section className="agenda-financeiro-workspace__hero operations-hero overflow-hidden rounded-3xl border p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.17em] text-emerald-300"><span className="h-px w-7 bg-emerald-400" />{isSpanish ? 'Operación integrada' : 'Operação integrada'}</div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{isSpanish ? 'Agenda y Caja' : 'Agenda & Caixa'}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{isSpanish ? 'Organizá horarios, confirmá cobros y mantené la caja conectada a cada atención, sin duplicar registros.' : 'Organize horários, confirme recebimentos e mantenha o caixa conectado a cada atendimento — sem duplicar lançamentos.'}</p>
          </div>
          <div className="agenda-financeiro-workspace__actions flex flex-wrap gap-2">
            <button type="button" onClick={() => setTransactionDialog('expense')} className="rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2.5 text-xs font-bold text-slate-200 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10"><ArrowDownRight className="mr-1.5 inline h-4 w-4 text-rose-300" />{isSpanish ? 'Nuevo gasto' : 'Nova despesa'}</button>
            <button type="button" onClick={() => setAppointmentDialog({ mode: 'new' })} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition-transform active:scale-[0.98]"><Plus className="mr-1.5 inline h-4 w-4" />{isSpanish ? 'Nuevo agendamiento' : 'Novo agendamento'}</button>
          </div>
        </div>
      </section>

      <div className="responsive-tab-strip flex w-full gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/75 p-1 sm:w-fit">
        {([[ 'unified', isSpanish ? 'Vista unificada' : 'Visão unificada' ], [ 'agenda', 'Agenda' ], [ 'financial', isSpanish ? 'Finanzas' : 'Financeiro' ]] as Array<[CenterView, string]>).map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold transition-colors ${view === key ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{label}</button>)}
      </div>

      <section className="agenda-financeiro-workspace__metrics grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<CalendarDays className="h-4 w-4" />} label={isSpanish ? 'Agendamientos de hoy' : 'Agendamentos hoje'} value={String(todayAppointments.length)} note={todayAppointments.length ? (isSpanish ? `${todayAppointments.filter((event) => event.payment?.status !== 'pago').length} esperando registro` : `${todayAppointments.filter((event) => event.payment?.status !== 'pago').length} aguardando baixa`) : (isSpanish ? 'No hay atenciones en la agenda' : 'Nenhum atendimento na agenda')} tone="emerald" />
        <Metric icon={<ArrowUpRight className="h-4 w-4" />} label={isSpanish ? 'Cobrado en el período' : 'Recebido no período'} value={formatMoney(financial.received)} note={period === 'month' ? (isSpanish ? 'Ingresos confirmados del mes' : 'Receitas confirmadas no mês') : (isSpanish ? 'Todos los ingresos confirmados' : 'Todas as receitas confirmadas')} tone="emerald" />
        <Metric icon={<AlertCircle className="h-4 w-4" />} label={isSpanish ? 'Pendiente' : 'Em aberto'} value={formatMoney(financial.open)} note={financial.overdue ? (isSpanish ? `${formatMoney(financial.overdue)} atrasado` : `${formatMoney(financial.overdue)} em atraso`) : (isSpanish ? 'No hay cobros atrasados' : 'Nenhuma cobrança atrasada')} tone="amber" />
        <Metric icon={<WalletCards className="h-4 w-4" />} label={isSpanish ? 'Resultado neto' : 'Resultado líquido'} value={formatMoney(financial.net)} note={isSpanish ? `${formatMoney(financial.spent)} en gastos del período` : `${formatMoney(financial.spent)} em despesas no período`} tone={financial.net >= 0 ? 'blue' : 'rose'} />
      </section>

      {!hasOperationalData && !loadingEvents && <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-6 text-center"><CircleDollarSign className="mx-auto h-7 w-7 text-emerald-400" /><h2 className="mt-3 font-bold text-white">{isSpanish ? 'La central está lista para recibir datos reales' : 'A central está pronta para receber dados reais'}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{isSpanish ? 'Todavía no hay atenciones ni registros vinculados en este período. Esto no indica ausencia de ventas; puede reflejar simplemente el inicio de uso del módulo.' : 'Ainda não há atendimentos ou lançamentos vinculados neste período. Isso não indica ausência de vendas; pode apenas refletir o início da adoção do módulo.'}</p></section>}

      {(view === 'unified' || view === 'agenda') && <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 shadow-lg sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-white">{isSpanish ? 'Agenda operativa' : 'Agenda operacional'}</h2>
              <p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Eventos reales del calendario, cobro y atención en el mismo flujo.' : 'Eventos reais do calendário, cobrança e atendimento no mesmo fluxo.'}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
              <button onClick={() => changeMonth(-1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={isSpanish ? 'Mes anterior' : 'Mês anterior'}><ChevronLeft className="h-4 w-4" /></button>
              <div className="min-w-36 px-1 text-center">
                <p className="text-xs font-bold capitalize text-slate-200">{monthLabel}</p>
                <p className="mt-0.5 truncate text-[10px] font-medium text-emerald-300">{selectedDateLabel}</p>
              </div>
              <button onClick={() => changeMonth(1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={isSpanish ? 'Mes siguiente' : 'Próximo mês'}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300">{isSpanish ? 'Día seleccionado' : 'Dia selecionado'}</p>
              <p className="truncate text-xs font-semibold text-slate-200">{selectedDateLabel} · {selectedDateEvents.length === 1 ? (isSpanish ? '1 cita' : '1 compromisso') : `${selectedDateEvents.length} ${isSpanish ? 'citas' : 'compromissos'}`}{selectedDate === dateInputValue(new Date()) ? ` · ${isSpanish ? 'hoy' : 'hoje'}` : ''}</p>
            </div>
            <button type="button" onClick={goToToday} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/15">{isSpanish ? 'Ir a hoy' : 'Ir para hoje'}</button>
          </div>

          {loadingEvents ? <div className="grid grid-cols-7 gap-1.5 animate-pulse sm:gap-2">{Array.from({ length: 28 }, (_, index) => <div key={index} className="h-14 rounded-xl bg-slate-800/70 sm:h-16" />)}</div> : eventsError ? <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"><p>{eventsError}</p><button onClick={refreshEvents} className="mt-2 text-xs font-bold underline">{isSpanish ? 'Intentar nuevamente' : 'Tentar novamente'}</button></div> : <div className="grid grid-cols-7 gap-1 sm:gap-1.5"><div className="col-span-7 grid grid-cols-7 gap-1 pb-1 text-center text-[9px] font-bold uppercase tracking-wider text-slate-500 sm:gap-1.5 sm:text-[10px]">{(isSpanish ? ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']).map((day) => <span key={day}>{day}</span>)}</div>{Array.from({ length: (calendarDate.getDay() + 6) % 7 }, (_, index) => <div key={`blank-${index}`} />)}{eventDays.map(({ day, appointments }) => { const dayKey = dateInputValue(day); const isToday = dayKey === dateInputValue(new Date()); const isSelected = dayKey === selectedDate; return                   <button type="button" key={day.toISOString()} onClick={() => { setSelectedDate(dayKey); setAppointmentDialog({ mode: 'new', initialDate: dayKey }); }} aria-label={`${isToday ? (isSpanish ? 'Hoy, ' : 'Hoje, ') : ''}${day.getDate()} ${monthLabel}`} aria-pressed={isSelected} className={`min-h-14 rounded-lg border p-1 text-left transition-colors sm:min-h-16 sm:rounded-xl sm:p-1.5 ${isSelected ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/45' : appointments.length ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}><div className="flex items-center justify-between gap-1"><span className={`flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold ${isToday ? 'bg-emerald-400 px-1 text-slate-950' : isSelected ? 'bg-emerald-500/15 px-1 text-emerald-200' : 'text-slate-300'}`}>{day.getDate()}</span>{appointments.length > 0 && <span className="rounded-full bg-emerald-400 px-1.5 text-[8px] font-black text-slate-950">{appointments.length}</span>}</div><div className="mt-1 space-y-0.5">{appointments.slice(0, 1).map((event) => <span key={event.id} className="block truncate rounded bg-slate-900 px-1 py-0.5 text-[8px] font-medium text-slate-300 sm:text-[9px]">{new Date(event.startIso).toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' })} {event.summary.replace(/^\[[^\]]+\]\s*/, '')}</span>)}{appointments.length > 1 && <span className="block text-[8px] font-semibold text-emerald-300">+{appointments.length - 1}</span>}</div></button>; })}</div>}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-lg"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-white">{isSpanish ? 'Próximos compromisos' : 'Próximos compromissos'}</h2><p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Acciones que requieren atención a continuación.' : 'Ações que exigem atenção na sequência.'}</p></div><button type="button" onClick={refreshEvents} className="text-xs font-bold text-emerald-300 hover:text-emerald-200">{isSpanish ? 'Actualizar' : 'Atualizar'}</button></div><div className="space-y-3">{nextAppointments.length ? nextAppointments.map((event) => <div key={event.id}><EventCard calendarEvent={event} compact /></div>) : <p className="rounded-xl bg-slate-950/55 p-4 text-center text-xs text-slate-500">{isSpanish ? 'No se encontraron compromisos futuros este mes.' : 'Nenhum compromisso futuro encontrado neste mês.'}</p>}</div></div>
      </section>}

      {(view === 'unified' || view === 'financial') && <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-lg"><div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="font-bold text-white">{isSpanish ? 'Flujo financiero' : 'Fluxo financeiro'}</h2><p className="mt-1 text-xs text-slate-400">{isSpanish ? 'Ingresos vinculados a la agenda, registros manuales y gastos operativos.' : 'Receitas vinculadas à agenda, lançamentos manuais e despesas operacionais.'}</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value as 'month' | 'all')} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200"><option value="month">{isSpanish ? 'Mes actual' : 'Mês atual'}</option><option value="all">{isSpanish ? 'Todo el historial' : 'Todo histórico'}</option></select><button type="button" onClick={() => setTransactionDialog('income')} className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/15"><Plus className="mr-1 inline h-3.5 w-3.5" />{isSpanish ? 'Ingreso adicional' : 'Receita avulsa'}</button></div></div><div className="responsive-table-scroll overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-3 font-bold">{isSpanish ? 'Fecha' : 'Data'}</th><th className="pb-3 font-bold">{isSpanish ? 'Cliente / descripción' : 'Cliente / descrição'}</th><th className="pb-3 font-bold">{isSpanish ? 'Tipo' : 'Tipo'}</th><th className="pb-3 font-bold">{isSpanish ? 'Estado' : 'Status'}</th><th className="pb-3 text-right font-bold">{isSpanish ? 'Valor' : 'Valor'}</th><th className="pb-3" /></tr></thead><tbody className="divide-y divide-slate-800/80">{financial.scoped.length ? financial.scoped.map((transaction) => <tr key={transaction.id} className="transition-colors hover:bg-slate-800/30"><td className="py-3.5 text-slate-400">{new Date(transaction.date).toLocaleDateString(displayLocale)}</td><td className="py-3.5"><p className="font-bold text-slate-200">{transaction.productName}</p><p className="mt-0.5 text-[10px] text-slate-500">{transaction.entryType === 'expense' ? (isSpanish ? 'Gasto operativo' : 'Despesa operacional') : transaction.leadName}</p></td><td className="py-3.5"><span className={`inline-flex items-center gap-1 font-bold ${transaction.entryType === 'expense' ? 'text-rose-300' : 'text-emerald-300'}`}>{transaction.entryType === 'expense' ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{transaction.entryType === 'expense' ? (isSpanish ? 'Gasto' : 'Despesa') : (isSpanish ? 'Ingreso' : 'Receita')}</span></td><td className="py-3.5"><button type="button" onClick={() => transaction.status !== 'pago' && onUpdateTransactionStatus(transaction.id, 'pago')} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusStyle[transaction.status]}`}>{transaction.status}</button></td><td className={`py-3.5 text-right font-black ${transaction.entryType === 'expense' ? 'text-rose-300' : 'text-emerald-300'}`}>{transaction.entryType === 'expense' ? '-' : '+'}{formatMoney(transaction.amount)}</td><td className="py-3.5 text-right"><button type="button" onClick={() => onDeleteTransaction(transaction.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title={isSpanish ? 'Eliminar registro' : 'Excluir lançamento'}><Trash2 className="h-3.5 w-3.5" /></button></td></tr>) : <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-500">{isSpanish ? 'Todavía no hay registros reales para este filtro.' : 'Ainda não há lançamentos reais para este filtro.'}</td></tr>}</tbody></table></div></section>}

      {appointmentDialog && <AppointmentDialog dialog={appointmentDialog} leads={leads} currency={currency} isSpanish={isSpanish} onClose={() => setAppointmentDialog(null)} onSubmit={saveAppointment} submitting={submitting} />}
      {transactionDialog && <TransactionDialog kind={transactionDialog} leads={leads} currency={currency} isSpanish={isSpanish} onClose={() => setTransactionDialog(null)} onSubmit={saveTransaction} submitting={submitting} />}
      {paymentDialog && <PaymentDialog event={paymentDialog} currency={currency} isSpanish={isSpanish} onClose={() => setPaymentDialog(null)} onSubmit={savePayment} submitting={submitting} />}
    </div>
  );
};

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

function PaymentDialog({ event, currency, isSpanish, onClose, onSubmit, submitting }: { event: CalendarEvent; currency: string; isSpanish: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitting: boolean }) { const paymentLabel = (method: PaymentMethod) => isSpanish ? ({ 'Transferência Bancária': 'Transferencia bancaria', 'Cartão de Crédito': 'Tarjeta de crédito', 'Boleto Bancário': 'Boleta bancaria', 'Link WhatsApp': 'Enlace de WhatsApp', PIX: 'PIX' }[method] || method) : method; return <DialogShell title={isSpanish ? 'Cobro del agendamiento' : 'Cobrança do agendamento'} description={isSpanish ? 'Este cobro usa la referencia del evento y se actualiza sin crear un registro duplicado.' : 'Esta cobrança usa a referência do evento e é atualizada sem criar um lançamento duplicado.'} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4 pt-5"><p className="rounded-xl bg-slate-950 p-3 text-sm font-bold text-white">{event.summary}</p><div className="grid grid-cols-2 gap-4"><Field label={`${isSpanish ? 'Valor' : 'Valor'} (${currency})`}><input name="amount" type="number" min="0" step="0.01" required defaultValue={event.payment?.amount ?? ''} className={inputClass} /></Field><Field label={isSpanish ? 'Forma' : 'Forma'}><select name="paymentMethod" defaultValue={event.payment?.paymentMethod || 'PIX'} className={inputClass}>{PAYMENT_METHODS.map((method) => <option key={method}>{paymentLabel(method)}</option>)}</select></Field></div><Field label={isSpanish ? 'Situación' : 'Situação'}><select name="status" defaultValue={event.payment?.status || 'pendente'} className={inputClass}><option value="pago">{isSpanish ? 'Cobrado' : 'Recebido'}</option><option value="pendente">{isSpanish ? 'Por cobrar' : 'A receber'}</option><option value="atrasado">{isSpanish ? 'Atrasado' : 'Em atraso'}</option><option value="cancelado">{isSpanish ? 'Cancelado' : 'Cancelado'}</option></select></Field><button type="submit" disabled={submitting} className="w-full rounded-xl bg-emerald-400 py-3 text-xs font-black text-slate-950 disabled:opacity-50">{submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : (isSpanish ? 'Guardar cobro' : 'Salvar cobrança')}</button></form></DialogShell>; }
