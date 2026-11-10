import React, { useEffect, useState } from 'react';
import type { ContactAiReadiness } from '../../types';

const reasons: Record<string, [string, string]> = {
  ready: ['Agente ativo, contato elegível, canal verificado e recebimento recente confirmado para este lead. A IA pode responder à próxima mensagem.', 'Agente activo, contacto habilitado, canal verificado y recepción reciente confirmada para este lead. La IA puede responder al próximo mensaje.'],
  generating: ['A IA está gerando uma resposta para este lead.', 'La IA está generando una respuesta para este lead.'],
  agent_paused: ['O agente está pausado para toda a empresa.', 'El agente está pausado para toda la empresa.'],
  restricted_hours: ['O agente está em horário de silêncio (08h–20h, Paraguai).', 'El agente está en horario de silencio (08–20 h, Paraguay).'],
  contact_blocked: ['A IA está bloqueada para este contato.', 'La IA está bloqueada para este contacto.'],
  operator_active: ['Um operador respondeu recentemente. A IA aguarda a pausa de 5 minutos ou a devolução do atendimento.', 'Un operador respondió recientemente. La IA espera la pausa de 5 minutos o la devolución de la atención.'],
  operator_started: ['Conversa iniciada pelo operador e ainda não identificada como lead de anúncio.', 'Conversación iniciada por el operador y aún no identificada como lead de anuncio.'],
  ads_only: ['Somente anúncios: a próxima mensagem precisa identificar este contato como lead de anúncio para liberar a IA.', 'Solo anuncios: el próximo mensaje debe identificar este contacto como lead de anuncio para habilitar la IA.'],
  leads_only: ['Somente leads: a IA avaliará se a próxima mensagem é comercial antes de responder.', 'Solo leads: la IA evaluará si el próximo mensaje es comercial antes de responder.'],
  ai_unavailable: ['O serviço de IA não está configurado no servidor.', 'El servicio de IA no está configurado en el servidor.'],
  knowledge_unavailable: ['A base de conhecimento publicada não está disponível.', 'La base de conocimiento publicada no está disponible.'],
  channel_disconnected: ['O canal não está conectado. A próxima mensagem pode não chegar ao Universo.', 'El canal no está conectado. El próximo mensaje puede no llegar a Universo.'],
  channel_unverified: ['Não foi possível confirmar a conexão do canal.', 'No se pudo confirmar la conexión del canal.'],
  receive_unverified: ['Não há mensagem recebida deste lead nos últimos 15 minutos para confirmar a sincronização. Isso não significa que o canal esteja desconectado.', 'No hay un mensaje recibido de este lead en los últimos 15 minutos para confirmar la sincronización. Esto no significa que el canal esté desconectado.'],
  last_reply_failed: ['A última tentativa recente da IA falhou ou não teve envio confirmado. A prontidão precisa ser verificada novamente.', 'El último intento reciente de la IA falló o no tuvo envío confirmado. Se debe verificar nuevamente la disponibilidad.'],
  unavailable: ['Não foi possível confirmar as condições de atendimento. O indicador não comprova disponibilidade.', 'No se pudieron confirmar las condiciones de atención. El indicador no confirma disponibilidad.'],
};

export function aiReadinessPresentation(readiness: ContactAiReadiness | null | undefined, real: boolean, now: number, spanish = false) {
  const language = spanish ? 1 : 0;
  if (!real) return { state: 'unknown', label: spanish ? 'Demostración' : 'Demonstração', title: spanish ? 'Conversación simulada, sin atención real.' : 'Conversa simulada, sem atendimento real.' };
  const valid = readiness && Date.parse(readiness.validUntil) > now && Date.parse(readiness.checkedAt) <= now
    && Date.parse(readiness.validUntil) - Date.parse(readiness.checkedAt) <= 45000
    && ['ready', 'busy', 'blocked', 'conditional', 'unknown'].includes(readiness.state) && reasons[readiness.reason];
  if (!valid) return { state: 'unknown', label: spanish ? 'IA: estado incierto' : 'IA: status incerto', title: reasons.unavailable[language] };
  const labels = {
    ready: spanish ? 'IA en atención' : 'IA no atendimento',
    busy: spanish ? 'IA respondiendo' : 'IA respondendo',
    blocked: spanish ? 'IA no disponible' : 'IA indisponível',
    conditional: spanish ? 'IA condicionada' : 'IA condicionada',
    unknown: spanish ? 'IA: estado incierto' : 'IA: status incerto',
  };
  return { state: readiness.state, label: labels[readiness.state], title: reasons[readiness.reason][language] };
}

export function AiReadinessBadge({ readiness, real, spanish }: { readiness?: ContactAiReadiness | null; real: boolean; spanish: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const badge = aiReadinessPresentation(readiness, real, now, spanish);
  const color = badge.state === 'ready' ? 'text-emerald-400 bg-emerald-950/60 border-emerald-700/50'
    : badge.state === 'busy' ? 'text-sky-300 bg-sky-950/60 border-sky-700/50'
    : badge.state === 'unknown' ? 'text-slate-300 bg-slate-800 border-slate-600'
    : 'text-amber-400 bg-amber-950/60 border-amber-700/50';
  return <span title={badge.title} role="status" className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${color}`}>
    <span className={`w-1.5 h-1.5 rounded-full bg-current ${badge.state === 'busy' ? 'animate-pulse' : ''}`} />{badge.label}
  </span>;
}
