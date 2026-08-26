import React from 'react';
import { ArrowRight, CheckCircle2, Circle, LockKeyhole, PlayCircle, ShieldCheck } from 'lucide-react';
import type { ActiveTab } from '../types';
import type { TenantActivationStatus } from '../lib/tenantActivation';

interface TenantActivationChecklistProps {
  status: TenantActivationStatus;
  canConfigure: boolean;
  onNavigate: (tab: ActiveTab) => void;
}

export const TenantActivationChecklist: React.FC<TenantActivationChecklistProps> = ({
  status,
  canConfigure,
  onNavigate,
}) => {
  const requiredSteps = status.steps.filter((step) => step.blocking);
  const completedRequiredSteps = requiredSteps.filter((step) => step.completed).length;
  const progress = requiredSteps.length ? Math.round((completedRequiredSteps / requiredSteps.length) * 100) : 100;

  if (status.isOperationallyReady) {
    return (
      <section className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3.5 sm:p-4" aria-labelledby="activation-ready-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 rounded-lg bg-emerald-400/10 p-2 text-emerald-300"><ShieldCheck className="h-4 w-4" /></span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300">Ativação concluída</p>
              <h2 id="activation-ready-heading" className="mt-1 text-sm font-bold text-slate-100">Agente pronto para operar</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">O canal, o contexto comercial, a agenda e os serviços foram verificados. Antes da primeira campanha, faça uma conversa de teste.</p>
            </div>
          </div>
          <button type="button" onClick={() => onNavigate('whatsapp')} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <PlayCircle className="h-3.5 w-3.5" /> Testar atendimento
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3.5 sm:p-4" aria-labelledby="activation-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">Ativação guiada</p>
          <h2 id="activation-heading" className="mt-1 text-base font-bold text-slate-100">Deixe o agente pronto para atender</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Conclua as etapas obrigatórias antes de enviar leads para este número.</p>
        </div>
        <span className="shrink-0 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs font-bold text-amber-200">{completedRequiredSteps}/{requiredSteps.length} obrigatórias</span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-950/60" aria-label={`${progress}% da ativação obrigatória concluída`}>
        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 space-y-1.5">
        {status.steps.map((step, index) => {
          const canOpenStep = step.destination === 'whatsapp' || canConfigure;
          const isLocked = !canOpenStep && !step.completed;
          return (
            <div key={step.id} className={`flex items-start gap-2.5 rounded-xl p-2.5 ${step.completed ? 'bg-emerald-500/5' : step.blocking ? 'bg-slate-950/35' : 'bg-slate-900/35'}`}>
              <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${step.completed ? 'bg-emerald-400/10 text-emerald-300' : step.blocking ? 'bg-amber-400/10 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
                {step.completed ? <CheckCircle2 className="h-4 w-4" /> : step.blocking ? <Circle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-xs font-bold text-slate-100">{index + 1}. {step.title}</h3>
                  {!step.blocking && <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Recomendado</span>}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.description}</p>
              </div>
              {isLocked ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-500" title="Somente administradores podem alterar essa configuração"><LockKeyhole className="h-3 w-3" /> Administrador</span>
              ) : (
                <button type="button" onClick={() => onNavigate(step.destination)} className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold transition-colors focus:outline-none focus-visible:ring-2 ${step.completed ? 'text-emerald-300 hover:bg-emerald-400/10 focus-visible:ring-emerald-300' : 'text-amber-200 hover:bg-amber-400/10 focus-visible:ring-amber-300'}`}>
                  {step.actionLabel}<ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
