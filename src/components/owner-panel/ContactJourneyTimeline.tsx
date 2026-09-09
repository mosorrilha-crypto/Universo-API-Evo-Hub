import React from 'react';
import { CalendarPlus, CalendarClock, CalendarX, CheckCircle2, XCircle, Wallet, ArrowRight, History } from 'lucide-react';
import type { ContactJourneyEvent } from '../../types';

interface ContactJourneyTimelineProps {
  events: ContactJourneyEvent[];
  isLoading: boolean;
}

const APPOINTMENT_LABEL: Record<Extract<ContactJourneyEvent, { kind: 'appointment' }>['eventType'], string> = {
  created: 'Agendamento criado',
  rescheduled: 'Agendamento remarcado',
  cancelled: 'Agendamento cancelado',
  completed: 'Atendimento concluído',
  no_show: 'Cliente não compareceu',
  payment_verified: 'Pagamento verificado',
};

const APPOINTMENT_ICON: Record<Extract<ContactJourneyEvent, { kind: 'appointment' }>['eventType'], React.ElementType> = {
  created: CalendarPlus,
  rescheduled: CalendarClock,
  cancelled: CalendarX,
  completed: CheckCircle2,
  no_show: XCircle,
  payment_verified: Wallet,
};

function formatEventDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatScheduled(startIso?: string): string | null {
  if (!startIso) return null;
  try {
    return new Date(startIso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * Timeline cronológica da "jornada" do contato — histórico append-only de
 * agendamentos + mudanças de estágio do CRM (GET /api/conversations/:phone/journey).
 * Sem backfill: eventos anteriores ao deploy desta feature não aparecem aqui,
 * só o que acontecer dali pra frente. Complementa (não substitui) o bloco
 * "FICHA (PLANILHA)" acima, que continua mostrando o snapshot atual.
 */
export const ContactJourneyTimeline: React.FC<ContactJourneyTimelineProps> = ({ events, isLoading }) => {
  return (
    <div className="border-t border-slate-800/80 pt-4">
      <div className="flex items-center gap-1.5 mb-3">
        <History className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          Jornada do contato
        </span>
      </div>

      {isLoading ? (
        <div className="p-3 bg-slate-800/20 rounded-xl border border-slate-800 text-center">
          <span className="text-xs text-slate-500">Carregando histórico...</span>
        </div>
      ) : events.length === 0 ? (
        <div className="p-3 bg-slate-800/20 rounded-xl border border-slate-800 text-center">
          <span className="text-xs text-slate-500">
            Sem eventos registrados ainda — a jornada passa a ser preenchida a partir de agora.
          </span>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {events.map((event) => {
            if (event.kind === 'appointment') {
              const Icon = APPOINTMENT_ICON[event.eventType];
              const scheduled = formatScheduled(event.scheduledStart);
              return (
                <li key={event.id} className="flex items-start gap-2.5 p-2.5 bg-slate-800/40 rounded-xl border border-slate-800">
                  <Icon className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-200">{APPOINTMENT_LABEL[event.eventType]}</p>
                    {event.serviceSummary && <p className="text-[11px] text-slate-400 truncate">{event.serviceSummary}</p>}
                    {scheduled && <p className="text-[10px] text-slate-500">Horário: {scheduled}</p>}
                    <p className="text-[10px] text-slate-600 mt-0.5">{formatEventDate(event.createdAt)}</p>
                  </div>
                </li>
              );
            }
            return (
              <li key={event.id} className="flex items-start gap-2.5 p-2.5 bg-slate-800/40 rounded-xl border border-slate-800">
                <ArrowRight className="w-4 h-4 mt-0.5 shrink-0 text-sky-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-200">
                    {event.fromStage ? `Etapa: ${event.fromStage} → ${event.toStage}` : `Etapa definida: ${event.toStage}`}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5">{formatEventDate(event.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
