import React, { useMemo } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react';
import { ActiveTab, EscalationInfo, FinancialTransaction, LeadInfo, Tenant, UserProfile } from '../types';
import { useAppPreferences } from '../contexts/AppPreferencesContext';

interface OperationsCenterProps {
  activeTenant: Tenant;
  currentUser: UserProfile | null;
  leads: LeadInfo[];
  transactions: FinancialTransaction[];
  escalations: EscalationInfo[];
  canSeeFinancial: boolean;
  canSeeAdminTools: boolean;
  onNavigate: (tab: ActiveTab) => void;
}

const currency = (value: number, tenant: Tenant) => new Intl.NumberFormat(tenant.locale || 'es-PY', {
  style: 'currency',
  currency: tenant.currency || 'PYG',
  maximumFractionDigits: tenant.currency === 'PYG' ? 0 : 2,
}).format(value);

const formatShortDate = (value: string, language: 'pt' | 'es') => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return language === 'es' ? 'Hoy' : 'Hoje';
  return new Intl.DateTimeFormat(language === 'es' ? 'es-PY' : 'pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(parsed);
};

const firstName = (name?: string | null) => (name || 'Operador').trim().split(/\s+/)[0] || 'Operador';

export const OperationsCenter: React.FC<OperationsCenterProps> = ({
  activeTenant,
  currentUser,
  leads,
  transactions,
  escalations,
  canSeeFinancial,
  canSeeAdminTools,
  onNavigate,
}) => {
  const { language, t } = useAppPreferences();
  const summary = useMemo(() => {
    const unresolved = escalations.filter((item) => !item.resolved);
    const paymentReviews = unresolved.filter((item) => item.kind === 'payment_proof');
    const openLeads = leads.filter((lead) => lead.crmStage !== 'ganho' && lead.crmStage !== 'perdido');
    const uncompletedTasks = leads.flatMap((lead) => lead.crmTasks || []).filter((task) => !task.completed);
    const pendingTransactions = transactions.filter((transaction) => transaction.status === 'pendente' || transaction.status === 'atrasado');
    const paidTransactions = transactions.filter((transaction) => transaction.status === 'pago' && transaction.entryType !== 'expense');
    const paidRevenue = paidTransactions.reduce((total, transaction) => total + Number(transaction.amount || 0), 0);

    return {
      unresolved,
      paymentReviews,
      openLeads,
      uncompletedTasks,
      pendingTransactions,
      paidRevenue,
    };
  }, [escalations, leads, transactions]);

  const priorityCount = summary.unresolved.length + summary.uncompletedTasks.length + summary.pendingTransactions.length;
  const priorityItems = [
    ...summary.paymentReviews.map((item) => ({
      id: item.id,
      type: t('paymentReview'),
      description: item.contactName || item.phone,
      detail: item.lastMessage || t('receiptWaitingReview'),
      action: t('reviewNow'),
      icon: CircleDollarSign,
      tone: 'amber' as const,
      tab: 'escalations' as ActiveTab,
    })),
    ...summary.unresolved.filter((item) => item.kind !== 'payment_proof').map((item) => ({
      id: item.id,
      type: t('needsYou'),
      description: item.contactName || item.phone,
      detail: item.reason || t('conversationForwarded'),
      action: t('openPending'),
      icon: ShieldAlert,
      tone: 'sky' as const,
      tab: 'escalations' as ActiveTab,
    })),
    ...summary.uncompletedTasks.map((task) => ({
      id: task.id,
      type: t('commercialNextAction'),
      description: task.title,
      detail: task.dueDate ? `${language === 'es' ? 'Plazo' : 'Prazo'}: ${formatShortDate(task.dueDate, language)}` : language === 'es' ? 'Acompañá este lead para no perder el momento.' : 'Acompanhe este lead para não perder o timing.',
      action: t('viewSales'),
      icon: Target,
      tone: 'emerald' as const,
      tab: 'crm' as ActiveTab,
    })),
  ];

  const quickActions = [
    { label: t('openConversations'), description: t('openConversationsDetail'), icon: MessageSquare, tab: 'whatsapp' as ActiveTab, visible: true },
    { label: t('viewSalesPipeline'), description: t('opportunitiesInProgress', { count: summary.openLeads.length }), icon: UsersRound, tab: 'crm' as ActiveTab, visible: true },
    { label: t('organizeSchedule'), description: t('organizeScheduleDetail'), icon: CalendarClock, tab: 'agenda_financeiro' as ActiveTab, visible: canSeeFinancial },
    { label: t('followGrowth'), description: t('followGrowthDetail'), icon: Sparkles, tab: 'attribution' as ActiveTab, visible: canSeeAdminTools },
  ].filter((action) => action.visible);

  return (
    <section className="space-y-4 animate-page-enter">
      <div className="operations-hero relative overflow-hidden rounded-card border px-4 py-4 sm:px-5 sm:py-5">
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-pill border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" /> {t('dailyOperation')}
            </div>
            <h1 className="mt-2.5 text-xl font-bold tracking-tight text-white sm:text-2xl">{t('greeting', { name: firstName(currentUser?.name) })}</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-300">
              {priorityCount > 0
                ? t('operationNeedsAttention', { count: priorityCount })
                : t('operationOrganized')}
            </p>
          </div>
          <div className="rounded-panel border border-white/8 bg-slate-950/35 px-3 py-2 text-left xl:text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{t('activeCompany')}</p>
            <p className="mt-0.5 text-[13px] font-bold text-white">{activeTenant.name}</p>
            <p className="mt-0.5 text-[11px] capitalize text-slate-400">{formatShortDate(new Date().toISOString(), language)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('humanPending')} value={summary.unresolved.length} detail={t('humanPendingDetail')} icon={<ShieldAlert className="h-4 w-4" />} tone="amber" onClick={() => onNavigate('escalations')} />
        <MetricCard label={t('leadsInProgress')} value={summary.openLeads.length} detail={t('leadsInProgressDetail')} icon={<UsersRound className="h-4 w-4" />} tone="emerald" onClick={() => onNavigate('crm')} />
        <MetricCard label={t('nextActions')} value={summary.uncompletedTasks.length} detail={t('nextActionsDetail')} icon={<Clock3 className="h-4 w-4" />} tone="sky" onClick={() => onNavigate('crm')} />
        <MetricCard label={t('receivedPeriod')} value={currency(summary.paidRevenue, activeTenant)} detail={t('receivedPeriodDetail')} icon={<CheckCircle2 className="h-4 w-4" />} tone="blue" onClick={() => canSeeFinancial && onNavigate('agenda_financeiro')} disabled={!canSeeFinancial} />
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.8fr)]">
        <section className="rounded-card border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400">{t('smartQueue')}</p>
              <h2 className="mt-1 text-base font-bold text-white">{t('attentionNow')}</h2>
              <p className="mt-0.5 text-xs text-slate-400">{t('actionsPrioritized')} {priorityItems.length > 0 && `Exibindo ${priorityItems.length} item${priorityItems.length === 1 ? '' : 's'} da fila.`}</p>
            </div>
            {summary.unresolved.length > 0 && (
              <button onClick={() => onNavigate('escalations')} className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 transition-colors hover:text-emerald-100">
                {language === 'es' ? 'Ver todas' : 'Ver todas'} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {priorityItems.length > 0 ? (
            <div className="mt-5 space-y-2">
              {priorityItems.map((item) => {
                const Icon = item.icon;
                const tone = item.tone === 'amber'
                  ? 'border-amber-500/20 bg-amber-500/8 text-amber-300'
                  : item.tone === 'sky'
                    ? 'border-sky-500/20 bg-sky-500/8 text-sky-300'
                    : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300';
                return (
                  <button key={item.id} onClick={() => onNavigate(item.tab)} className="group flex w-full items-start gap-3 rounded-panel border border-slate-800 bg-slate-950/35 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-800/70">
                    <span className={`mt-0.5 rounded-control border p-2 ${tone}`}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{item.type}</span>
                      <span className="mt-1 block truncate text-sm font-bold text-slate-100">{item.description}</span>
                      <span className="mt-1 line-clamp-1 block text-xs text-slate-400">{item.detail}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-emerald-300 sm:inline-flex">{item.action}<ArrowRight className="h-3.5 w-3.5" /></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-panel border border-dashed border-emerald-500/25 bg-emerald-500/5 px-4 py-5 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-400" />
              <h3 className="mt-2 text-sm font-bold text-slate-100">{t('noCriticalPending')}</h3>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{t('noCriticalPendingDetail')}</p>
            </div>
          )}
        </section>

        <aside className="rounded-card border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400">{t('quickAccess')}</p>
          <h2 className="mt-1 text-base font-bold text-white">{t('followRoutine')}</h2>
          <div className="mt-3 space-y-1.5">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button key={action.label} onClick={() => onNavigate(action.tab)} className="group flex w-full items-center gap-2.5 rounded-panel border border-slate-800 bg-slate-950/35 px-2.5 py-2 text-left transition-all hover:border-emerald-500/35 hover:bg-emerald-500/8">
                  <span className="rounded-control border border-slate-700 bg-slate-800 p-1.5 text-emerald-400 group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10"><Icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-100">{action.label}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{action.description}</span></span>
                  <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-300" />
                </button>
              );
            })}
          </div>
          {canSeeFinancial && summary.pendingTransactions.length > 0 && (
            <button onClick={() => onNavigate('agenda_financeiro')} className="mt-5 flex w-full items-start gap-2 rounded-panel border border-amber-500/20 bg-amber-500/8 p-3 text-left">
              <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span><span className="block text-xs font-bold text-amber-100">{summary.pendingTransactions.length} recebimento(s) em aberto</span><span className="mt-0.5 block text-[11px] leading-relaxed text-amber-100/65">Confira a situação financeira antes do fechamento do dia.</span></span>
            </button>
          )}
        </aside>
      </div>
    </section>
  );
};

const MetricCard: React.FC<{ label: string; value: string | number; detail: string; icon: React.ReactNode; tone: 'emerald' | 'amber' | 'sky' | 'blue'; onClick: () => void; disabled?: boolean }> = ({ label, value, detail, icon, tone, onClick, disabled = false }) => {
  const tones = {
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    sky: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
    blue: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  };
  return (
    <button disabled={disabled} onClick={onClick} className="group rounded-card border border-slate-800 bg-slate-900/80 p-3 text-left shadow-md shadow-slate-950/15 transition-all hover:-translate-y-0.5 hover:border-slate-700 disabled:cursor-default disabled:hover:translate-y-0">
      <span className="flex items-center justify-between gap-3"><span className="text-[11px] font-semibold text-slate-400">{label}</span><span className={`rounded-control border p-1.5 ${tones[tone]}`}>{icon}</span></span>
      <span className="mt-2.5 block text-xl font-bold tracking-tight text-white">{value}</span>
      <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{detail}</span>
    </button>
  );
};
