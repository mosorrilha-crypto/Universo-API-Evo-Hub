import React from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, Clock3, ListChecks, Loader2, PencilLine, RefreshCw, Save, ShieldCheck, X } from 'lucide-react';
import type { ContactAgentContext } from '../types';

export interface OperatorMemoryEditPayload {
  preferredLanguage: string | null;
  preferredName: string | null;
  currentIntent: string | null;
  serviceInterest: string | null;
  objections: string[];
  nextBestAction: string | null;
}

type ContactContextPanelProps = {
  context: ContactAgentContext | null;
  isLoading: boolean;
  isSpanish?: boolean;
  variant: 'compact' | 'detail';
  onRetry?: () => void;
  onOpenDetails?: () => void;
  /** Salva somente a allowlist de memória segura, nunca estados vivos. */
  onSaveMemory?: (patch: Partial<OperatorMemoryEditPayload>) => Promise<void>;
  /** TASK-0187 (pedido direto, 01/09/2026): "x pra fechar o contexto da
      conversa quando ele aparece" — só no `variant="compact"`; o painel
      detalhado (`variant="detail"`, dentro da Ficha IA) já é opcional por
      natureza (só abre quando o operador pede), não precisa de fechar. */
  onDismiss?: () => void;
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
  onSaveMemory,
  onDismiss,
}) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editBaseline, setEditBaseline] = React.useState<OperatorMemoryEditPayload | null>(null);
  const [editForm, setEditForm] = React.useState<OperatorMemoryEditPayload>({
    preferredLanguage: null,
    preferredName: null,
    currentIntent: null,
    serviceInterest: null,
    objections: [],
    nextBestAction: null,
  });

  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim() || null;
  const startEditing = () => {
    const source = context?.memory;
    const next = {
      preferredLanguage: source?.preferredLanguage || null,
      preferredName: source?.preferredName || null,
      currentIntent: source?.currentIntent || null,
      serviceInterest: source?.serviceInterest || null,
      objections: source?.objections || [],
      nextBestAction: source?.nextBestAction || null,
    };
    setEditBaseline(next);
    setEditForm(next);
    setEditError(null);
    setIsEditing(true);
  };
  const cancelEditing = () => {
    setIsEditing(false);
    setEditError(null);
  };
  const saveEditing = async () => {
    if (!onSaveMemory || !editBaseline) return;
    const next: OperatorMemoryEditPayload = {
      preferredLanguage: normalizeText(editForm.preferredLanguage || ''),
      preferredName: normalizeText(editForm.preferredName || ''),
      currentIntent: normalizeText(editForm.currentIntent || ''),
      serviceInterest: normalizeText(editForm.serviceInterest || ''),
      objections: editForm.objections.map((item) => normalizeText(item) || '').filter(Boolean),
      nextBestAction: normalizeText(editForm.nextBestAction || ''),
    };
    const patch: Partial<OperatorMemoryEditPayload> = {};
    if (next.preferredLanguage !== editBaseline.preferredLanguage) patch.preferredLanguage = next.preferredLanguage;
    if (next.preferredName !== editBaseline.preferredName) patch.preferredName = next.preferredName;
    if (next.currentIntent !== editBaseline.currentIntent) patch.currentIntent = next.currentIntent;
    if (next.serviceInterest !== editBaseline.serviceInterest) patch.serviceInterest = next.serviceInterest;
    if (JSON.stringify(next.objections) !== JSON.stringify(editBaseline.objections)) patch.objections = next.objections;
    if (next.nextBestAction !== editBaseline.nextBestAction) patch.nextBestAction = next.nextBestAction;
    if (!Object.keys(patch).length) return cancelEditing();

    setIsSaving(true);
    setEditError(null);
    try {
      await onSaveMemory(patch);
      setIsEditing(false);
    } catch (error: any) {
      setEditError(error?.message || 'Não foi possível salvar a correção agora.');
    } finally {
      setIsSaving(false);
    }
  };

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
    // Achado real de UI (pedido direto, 29/08/2026: "não sei se é necessário
    // aparecer tão grande assim") — toda conversa nova (sem memória nem
    // decisão registrada ainda) mostrava essa faixa mesmo assim, só pra dizer
    // "ainda não há nada aqui". Isso é ruído puro: some enquanto não houver
    // dado real; volta a aparecer sozinha assim que a IA gerar a primeira
    // memória/decisão pra esse contato. O estado de erro/indisponível acima
    // (isUnavailable) nunca é escondido — só o "vazio de verdade" é.
    if (!hasData) return null;
    return (
      <div className="atendimento-context-strip border-sky-500/20 bg-sky-950/15">
        <div className="atendimento-context-strip__copy min-w-0">
          <span className="atendimento-context-strip__label text-sky-300">{isSpanish ? 'CONTEXTO SUPERVISADO' : 'CONTEXTO SUPERVISIONADO'}</span>
          <p className="line-clamp-2 text-slate-100">
            {primaryAction || (isSpanish ? 'Sin acción sugerida por ahora.' : 'Sem ação sugerida no momento.')}
          </p>
          {(needsHuman || memory?.openLoops?.length) && (
            <span className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${needsHuman ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
              {needsHuman ? <ShieldCheck className="h-3 w-3 shrink-0" /> : <ListChecks className="h-3 w-3 shrink-0" />}
              <span className="truncate">{needsHuman ? (isSpanish ? 'Confirmación humana requerida' : 'Confirmação humana necessária') : memory!.openLoops[0].summary}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenDetails && (
            <button type="button" onClick={onOpenDetails} className="atendimento-context-strip__action text-sky-200 hover:text-white">
              {isSpanish ? 'Ver contexto' : 'Ver contexto'}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-1 text-sky-300/70 hover:bg-white/10 hover:text-white cursor-pointer"
              title={isSpanish ? 'Cerrar' : 'Fechar'}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    // TASK-0247 (pedido direto, 03/09/2026, print do mobile no tema claro):
    // `bg-slate-950/65` cai na auditoria geral de -950 (index.css), que
    // mapeia pra `var(--surface-sunken)` — certo pra um "poço" recuado
    // dentro de um card (ex: input, bloco de código), mas errado aqui: este
    // é o painel PRINCIPAL da Ficha, deveria ficar branco igual aos cards
    // vizinhos (`--surface-panel`), não cinza-amarelado. `contact-context-detail`
    // dá a especificidade extra (2 classes) pra vencer a regra geral sem
    // precisar mexer nela (ela está certa pros outros usos de -950).
    <section className="contact-context-detail overflow-hidden rounded-xl border border-sky-500/25 bg-slate-950/65">
      <div className="flex items-start justify-between gap-3 border-b border-sky-500/15 p-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300"><Bot className="h-3.5 w-3.5" /> {isSpanish ? 'Contexto supervisado' : 'Contexto supervisionado'}</span>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{isSpanish ? 'Memoria y última decisión visibles para revisión; no autorizan acciones sensibles.' : 'Memória e última decisão visíveis para revisão; não autorizam ações sensíveis.'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {formattedUpdated && <span className="text-[9px] text-slate-500">{formattedUpdated}</span>}
          {onSaveMemory && !isEditing && (
            <button type="button" onClick={startEditing} className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[10px] font-bold text-sky-200 hover:bg-sky-500/20 transition-colors cursor-pointer">
              <PencilLine className="h-3 w-3" /> {isSpanish ? 'Corregir' : 'Corrigir'}
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <OperatorMemoryEditor
          form={editForm}
          onChange={setEditForm}
          onCancel={cancelEditing}
          onSave={() => void saveEditing()}
          isSaving={isSaving}
          error={editError}
          isSpanish={isSpanish}
        />
      )}

      {!hasData && !isEditing ? (
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


function OperatorMemoryEditor({
  form,
  onChange,
  onCancel,
  onSave,
  isSaving,
  error,
  isSpanish,
}: {
  form: OperatorMemoryEditPayload;
  onChange: React.Dispatch<React.SetStateAction<OperatorMemoryEditPayload>>;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  error: string | null;
  isSpanish: boolean;
}) {
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none';
  return (
    <form
      className="space-y-3 border-b border-sky-500/15 bg-sky-950/10 p-3"
      onSubmit={(event) => { event.preventDefault(); onSave(); }}
    >
      <div className="flex items-start gap-2">
        <PencilLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
        <div>
          <p className="text-[11px] font-bold text-sky-100">{isSpanish ? 'Corrección humana de memoria' : 'Correção humana de memória'}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{isSpanish ? 'Se registra quién corrigió y qué campos fueron modificados. No se guardan los valores editados en la auditoría.' : 'Registra quem corrigiu e quais campos foram alterados. Os valores editados não entram no evento de auditoria.'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-slate-400">{isSpanish ? 'Nombre' : 'Nome'}
          <input value={form.preferredName || ''} onChange={(event) => onChange((current) => ({ ...current, preferredName: event.target.value || null }))} className={inputClass} maxLength={120} />
        </label>
        <label className="text-[10px] font-bold text-slate-400">{isSpanish ? 'Idioma' : 'Idioma'}
          <input value={form.preferredLanguage || ''} onChange={(event) => onChange((current) => ({ ...current, preferredLanguage: event.target.value || null }))} className={inputClass} placeholder="Ex.: pt-BR ou es-PY" maxLength={32} />
        </label>
        <label className="text-[10px] font-bold text-slate-400">{isSpanish ? 'Intención' : 'Intenção'}
          <input value={form.currentIntent || ''} onChange={(event) => onChange((current) => ({ ...current, currentIntent: event.target.value || null }))} className={inputClass} maxLength={80} />
        </label>
        <label className="text-[10px] font-bold text-slate-400">{isSpanish ? 'Interés' : 'Interesse'}
          <input value={form.serviceInterest || ''} onChange={(event) => onChange((current) => ({ ...current, serviceInterest: event.target.value || null }))} className={inputClass} maxLength={160} />
        </label>
      </div>

      <label className="block text-[10px] font-bold text-slate-400">{isSpanish ? 'Objeciones, una por línea' : 'Objeções, uma por linha'}
        <textarea value={form.objections.join('\n')} onChange={(event) => onChange((current) => ({ ...current, objections: event.target.value.split('\n') }))} className={`${inputClass} min-h-18 resize-y`} maxLength={1200} />
      </label>
      <label className="block text-[10px] font-bold text-slate-400">{isSpanish ? 'Próximo paso sugerido' : 'Próximo passo sugerido'}
        <textarea value={form.nextBestAction || ''} onChange={(event) => onChange((current) => ({ ...current, nextBestAction: event.target.value || null }))} className={`${inputClass} min-h-16 resize-y`} maxLength={240} />
      </label>

      <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-950/20 p-2 text-[10px] leading-relaxed text-amber-100/85">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span>{isSpanish ? 'Pago, comprobante, agenda, confirmación y escalamiento no se editan aquí; continúan en sus controles humanos propios.' : 'Pagamento, comprovante, agenda, confirmação e escalonamento não são editados aqui; continuam nos seus próprios controles humanos.'}</span>
      </div>
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-2 text-[11px] text-rose-200">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isSaving} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"><X className="h-3.5 w-3.5" />{isSpanish ? 'Cancelar' : 'Cancelar'}</button>
        <button type="submit" disabled={isSaving} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors cursor-pointer">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{isSaving ? (isSpanish ? 'Guardando...' : 'Salvando...') : (isSpanish ? 'Guardar corrección' : 'Salvar correção')}</button>
      </div>
    </form>
  );
}
