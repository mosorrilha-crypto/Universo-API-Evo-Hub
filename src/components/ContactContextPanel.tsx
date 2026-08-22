import React from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, Clock3, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ContactAgentContext } from '../types';

type ContactContextPanelProps = {
  context: ContactAgentContext | null;
  isLoading: boolean;
  isSpanish?: boolean;
  variant: 'compact' | 'detail';
  onRetry?: () => void;
  onOpenDetails?: () => void;
};

const paymentStatusLabel: Record<string, string> = {
  awaiting_payment: 'Aguardando comprovante',
  pending_verification: 'Comprovante em verificação humana',
  rejected: 'Comprovante rejeitado',
  verified: 'Pagamento verificado',
  confirmed: 'Pagamento confirmado no registro',
};

function formatContextDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function contextFallbackCopy(isSpanish: boolean) {
  return isSpanish
    ? 'El contexto supervisado no está disponible ahora. Las protecciones humanas siguen activas.'
    : 'O contexto supervisionado não está disponível agora. As proteções humanas continuam ativas.';
}

export const ContactContextPanel: React.FC<ContactContextPanelProps> = ({
  context,
  isLoading,
  isSpanish = false,
  variant,
  onRetry,
  onOpenDetails,
}) => {
  if (isLoading) {
    return variant === 'compact' ? (
      <div className="atendimento-context-strip animate-pulse" aria-live="polite">
        <div className="h-3 w-24 rounded bg-slate-700" />
        <div className="h-3 flex-1 rounded bg-slate-800" />
      </div>
    ) : (
      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 animate-pulse">
        <div className="h-3 w-32 rounded bg-slate-700" />
        <div className="mt-3 h-10 rounded bg-slate-800" />
      </section>
    );
  }

  const isUnavailable = !context || !context.available;
  if (isUnavailable) {
    const content = (
      <>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">{isSpanish ? 'Contexto supervisado' : 'Contexto supervisionado'}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">{contextFallbackCopy(isSpanish)}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-amber-500/30 px-2 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer">
            <RefreshCw className="h-3 w-3" /> {isSpanish ? 'Reintentar' : 'Tentar'}
          </button>
        )}
      </>
    );
    return variant === 'compact'
      ? <div className="atendimento-context-strip border-amber-500/25 bg-amber-950/20">{content}</div>
      : <section className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-950/20 p-3">{content}</section>;
  }

  const memory = context.memory;
  const decision = context.latestDecision;
  const hasData = !!memory || !!decision;
  const needsHuman = !!decision?.needsHumanConfirmation;
  const primaryAction = memory?.nextBestAction || decision?.reasoningSummary || null;
  const formattedUpdated = formatContextDate(memory?.updatedAt || decision?.createdAt);
  const paymentStatus = typeof decision?.selectedFacts?.paymentStatus === 'string'
    ? decision.selectedFacts.paymentStatus
    : null;
  const hasAppointment = decision?.selectedFacts?.hasActiveAppointment === true;
  const hasEscalation = decision?.selectedFacts?.hasOpenEscalation === true;

  if (variant === 'compact') {
    return (
      <div className="atendimento-context-strip border-sky-500/20 bg-sky-950/15">
        <div className="atendimento-context-strip__copy min-w-0">
          <span className="atendimento-context-strip__label text-sky-300">{isSpanish ? 'CONTEXTO SUPERVISADO' : 'CONTEXTO SUPERVISIONADO'}</span>
          <p className="truncate text-slate-100">
            {primaryAction || (isSpanish ? 'Aún no hay memoria ni decisión registrada para este contacto.' : 'Ainda não há memória nem decisão registrada para este contato.')}
          </p>
          {(needsHuman || memory?.openLoops?.length) && (
            <span className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${needsHuman ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
              {needsHuman ? <ShieldCheck className="h-3 w-3 shrink-0" /> : <ListChecks className="h-3 w-3 shrink-0" />}
              <span className="truncate">{needsHuman ? (isSpanish ? 'Confirmación humana requerida' : 'Confirmação humana necessária') : memory!.openLoops[0].summary}</span>
            </span>
          )}
        </div>
        {onOpenDetails && (
          <button type="button" onClick={onOpenDetails} className="atendimento-context-strip__action shrink-0 text-sky-200 hover:text-white">
            {isSpanish ? 'Ver contexto' : 'Ver contexto'}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-sky-500/25 bg-slate-950/65">
      <div className="flex items-start justify-between gap-3 border-b border-sky-500/15 p-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300"><Bot className="h-3.5 w-3.5" /> {isSpanish ? 'Contexto supervisado' : 'Contexto supervisionado'}</span>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{isSpanish ? 'Memoria y última decisión visibles para revisión; no autorizan acciones sensibles.' : 'Memória e última decisão visíveis para revisão; não autorizam ações sensíveis.'}</p>
        </div>
        {formattedUpdated && <span className="shrink-0 text-[9px] text-slate-500">{formattedUpdated}</span>}
      </div>

      {!hasData ? (
        <div className="p-3 text-[11px] leading-relaxed text-slate-500">{isSpanish ? 'Todavía no hay memoria estructurada ni decisión auditada para este contacto.' : 'Ainda não há memória estruturada nem decisão auditada para este contato.'}</div>
      ) : (
        <div className="space-y-3 p-3">
          {(memory?.serviceInterest || memory?.currentIntent || memory?.preferredLanguage) && (
            <div className="grid grid-cols-2 gap-2">
              {memory?.serviceInterest && <ContextFact label={isSpanish ? 'Interés' : 'Interesse'} value={memory.serviceInterest} />}
              {memory?.currentIntent && <ContextFact label={isSpanish ? 'Intención' : 'Intenção'} value={memory.currentIntent} />}
              {memory?.preferredLanguage && <ContextFact label={isSpanish ? 'Idioma' : 'Idioma'} value={memory.preferredLanguage} />}
              {memory?.preferredName && <ContextFact label={isSpanish ? 'Nombre registrado' : 'Nome registrado'} value={memory.preferredName} />}
            </div>
          )}

          {primaryAction && (
            <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-2.5">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-300"><ListChecks className="h-3 w-3" /> {isSpanish ? 'Próximo paso' : 'Próximo passo'}</span>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-sky-50">{primaryAction}</p>
            </div>
          )}

          {memory?.openLoops?.length ? (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{isSpanish ? 'Pendientes' : 'Pendências'}</span>
              <div className="mt-1.5 space-y-1.5">
                {memory.openLoops.slice(0, 3).map((loop, index) => (
                  <div key={`${loop.kind}-${index}`} className="flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-[11px] text-slate-300">
                    <Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
                    <span>{loop.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {decision && (
            <div className={`rounded-lg border p-2.5 ${needsHuman ? 'border-amber-500/30 bg-amber-950/20' : 'border-emerald-500/20 bg-emerald-950/15'}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-300">{decision.routerDecision}</span>
                {needsHuman ? <StatusPill tone="amber" icon={<ShieldCheck className="h-3 w-3" />} label={isSpanish ? 'Revisión humana' : 'Revisão humana'} /> : <StatusPill tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />} label={isSpanish ? 'Sin gate adicional' : 'Sem gate adicional'} />}
                {paymentStatus && <StatusPill tone="sky" label={paymentStatusLabel[paymentStatus] || paymentStatus} />}
                {hasAppointment && <StatusPill tone="slate" label={isSpanish ? 'Agenda activa' : 'Agenda ativa'} />}
                {hasEscalation && <StatusPill tone="amber" icon={<AlertTriangle className="h-3 w-3" />} label={isSpanish ? 'Escalado' : 'Escalonado'} />}
              </div>
              {decision.reasoningSummary && <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{decision.reasoningSummary}</p>}
              {decision.toolSummaries?.length ? (
                <details className="mt-2 rounded-md border border-slate-700/70 bg-slate-950/50 px-2 py-1.5">
                  <summary className="flex cursor-pointer items-center gap-1 text-[10px] font-bold text-slate-400"><ChevronDown className="h-3 w-3" /> {isSpanish ? 'Acciones consultadas' : 'Ações consultadas'}</summary>
                  <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-slate-400">
                    {decision.toolSummaries.slice(0, 3).map((summary) => <li key={summary}>• {summary}</li>)}
                  </ul>
                </details>
              ) : null}
            </div>
          )}

          <div className="flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[10px] leading-relaxed text-slate-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{isSpanish ? 'Este painel informa e orienta. Pagamento, confirmação de agenda e exceções seguem exigindo os controles humanos já definidos.' : 'Este painel informa e orienta. Pagamento, confirmação de agenda e exceções continuam exigindo os controles humanos já definidos.'}</span>
          </div>
        </div>
      )}
    </section>
  );
};

function ContextFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-2"><span className="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-200">{value}</span></div>;
}

function StatusPill({ tone, icon, label }: { tone: 'amber' | 'emerald' | 'sky' | 'slate'; icon?: React.ReactNode; label: string }) {
  const toneClasses = {
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    slate: 'border-slate-700 bg-slate-900 text-slate-300',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${toneClasses[tone]}`}>{icon}{label}</span>;
}
