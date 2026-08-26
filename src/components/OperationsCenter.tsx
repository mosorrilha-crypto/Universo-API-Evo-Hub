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
import { ActiveTab, AgentKnowledgeBase, BusinessHours, EscalationInfo, FinancialTransaction, LeadInfo, Tenant, UserProfile } from '../types';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import { evaluateTenantActivation } from '../lib/tenantActivation';
import { TenantActivationChecklist } from './TenantActivationChecklist';

interface OperationsCenterProps {
  activeTenant: Tenant;
  currentUser: UserProfile | null;
  leads: LeadInfo[];
  transactions: FinancialTransaction[];
  escalations: EscalationInfo[];
  knowledgeBase: AgentKnowledgeBase;
  businessHours: BusinessHours;
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
  knowledgeBase,
  businessHours,
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

  const activation = useMemo(
    () => evaluateTenantActivation(activeTenant, knowledgeBase, businessHours),
    [activeTenant.whatsappStatus, businessHours, knowledgeBase],
  );

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
      <div className="operations-hero relative overflow-hidden rounded-2xl border border-white/8 px-4 py-4 sm:px-5 sm:py-5">
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
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-slate-400 xl:mt-0 xl:max-w-xs">
            <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-slate-500">{t('activeCompany')}</span>
            <span className="truncate font-semibold text-slate-200">{activeTenant.name}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="shrink-0 capitalize">{formatShortDate(new Date().toISOString(), language)}</span>
          </div>
        </div>
      </div>

      <TenantActivationChecklist
        status={activation}
        canConfigure={canSeeAdminTools}
        onNavigate={onNavigate}
      />

      <section className="operations-quick-access rounded-2xl border border-slate-800/55 bg-slate-900/65 p-3.5 shadow-none sm:p-4" aria-labelledby="quick-access-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400">{t('quickAccess')}</p>
            <h2 id="quick-access-heading" className="mt-1 text-base font-bold text-white">{t('followRoutine')}</h2>
          </div>
          <span className="hidden shrink-0 text-[10px] text-slate-500 sm:inline">Atalhos da operação</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} type="button" onClick={() => onNavigate(action.tab)} className="operations-quick-action group flex min-w-0 items-center gap-2 rounded-xl bg-slate-950/30 px-2.5 py-2 text-left transition-colors hover:bg-emerald-500/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70">
                <span className="shrink-0 rounded-lg bg-slate-800/80 p-1.5 text-emerald-400 group-hover:bg-emerald-500/10"><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-100">{action.label}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{action.description}</span></span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-300" />
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label={t('humanPending')} value={summary.unresolved.length} detail={t('humanPendingDetail')} icon={<ShieldAlert className="h-4 w-4" />} tone="amber" onClick={() => onNavigate('escalations')} />
        <MetricCard label={t('leadsInProgress')} value={summary.openLeads.length} detail={t('leadsInProgressDetail')} icon={<UsersRound className="h-4 w-4" />} tone="emerald" onClick={() => onNavigate('crm')} />
        <MetricCard label={t('nextActions')} value={summary.uncompletedTasks.length} detail={t('nextActionsDetail')} icon={<Clock3 className="h-4 w-4" />} tone="sky" onClick={() => onNavigate('crm')} />
        <MetricCard label={t('receivedPeriod')} value={currency(summary.paidRevenue, activeTenant)} detail={t('receivedPeriodDetail')} icon={<CheckCircle2 className="h-4 w-4" />} tone="blue" onClick={() => canSeeFinancial && onNavigate('agenda_financeiro')} disabled={!canSeeFinancial} />
      </div>

      <section className="operations-smart-queue rounded-2xl border border-slate-800/55 bg-slate-900/65 p-3.5 shadow-none sm:p-4" aria-labelledby="smart-queue-heading">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400">{t('smartQueue')}</p>
              <h2 id="smart-queue-heading" className="mt-1 text-base font-bold text-white">{t('attentionNow')}</h2>
              <p className="mt-0.5 text-xs text-slate-400">{t('actionsPrioritized')} {priorityItems.length > 0 && `Exibindo ${priorityItems.length} item${priorityItems.length === 1 ? '' : 's'} da fila.`}</p>
            </div>
            {summary.unresolved.length > 0 && (
              <button onClick={() => onNavigate('escalations')} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/10 hover:text-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70">
                {language === 'es' ? 'Ver todas' : 'Ver todas'} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {canSeeFinancial && summary.pendingTransactions.length > 0 && (
            <button type="button" onClick={() => onNavigate('agenda_financeiro')} className="mt-3 flex w-full items-start gap-2 rounded-xl bg-amber-500/8 p-2.5 text-left transition-colors hover:bg-amber-500/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70">
              <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span><span className="block text-xs font-bold text-amber-100">{summary.pendingTransactions.length} recebimento(s) em aberto</span><span className="mt-0.5 block text-[11px] leading-relaxed text-amber-100/65">Confira a situação financeira antes do fechamento do dia.</span></span>
            </button>
          )}

          {priorityItems.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              {priorityItems.map((item) => {
                const Icon = item.icon;
                const tone = item.tone === 'amber'
                  ? 'bg-amber-500/10 text-amber-300'
                  : item.tone === 'sky'
                    ? 'bg-sky-500/10 text-sky-300'
                    : 'bg-emerald-500/10 text-emerald-300';
                return (
                  <button key={item.id} onClick={() => onNavigate(item.tab)} className="operations-priority-item group flex w-full items-start gap-2.5 rounded-xl bg-slate-950/30 p-2.5 text-left transition-colors hover:bg-slate-800/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70">
                    <span className={`mt-0.5 rounded-lg p-1.5 ${tone}`}><Icon className="h-4 w-4" /></span>
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
            <div className="mt-3 rounded-xl bg-emerald-500/5 px-4 py-4 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-400" />
              <h3 className="mt-2 text-sm font-bold text-slate-100">{t('noCriticalPending')}</h3>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{t('noCriticalPendingDetail')}</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
};

const MetricCard: React.FC<{ label: string; value: string | number; detail: string; icon: React.ReactNode; tone: 'emerald' | 'amber' | 'sky' | 'blue'; onClick: () => void; disabled?: boolean }> = ({ label, value, detail, icon, tone, onClick, disabled = false }) => {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-300',
    sky: 'bg-sky-500/10 text-sky-300',
    blue: 'bg-sky-500/10 text-sky-300',
  };
  return (
    <button disabled={disabled} onClick={onClick} className="group min-h-[5.5rem] rounded-xl bg-slate-900/65 p-2.5 text-left shadow-none transition-colors hover:bg-slate-800/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:cursor-default disabled:hover:bg-slate-900/65">
      <span className="flex items-center justify-between gap-2"><span className="line-clamp-1 text-[10px] font-semibold text-slate-400">{label}</span><span className={`rounded-lg p-1.5 ${tones[tone]}`}>{icon}</span></span>
      <span className="mt-1.5 block text-lg font-bold tracking-tight text-white">{value}</span>
      <span className="mt-0.5 line-clamp-1 block text-[9px] leading-4 text-slate-500">{detail}</span>
    </button>
  );
};
