/**
 * Marca "concluído" por evento da Agenda (UpcomingEventsPanel) — os eventos
 * em si continuam vivendo 100% no Google Calendar real, nunca duplicados
 * aqui; esta tabela só guarda a marca, porque o Calendar não tem esse
 * conceito nativo. Funciona pra qualquer evento (agendado pelo agente/painel
 * ou direto no Google Calendar), não só os que passam por appointments.ts.
 */
import { getDb } from './db';

export async function markEventCompleted(tenantId: string, eventId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('calendar_event_completions')
    .upsert({ tenant_id: tenantId, event_id: eventId, completed_at: new Date().toISOString() }, { onConflict: 'tenant_id,event_id' });
  if (error) throw error;
}

export async function markEventNotCompleted(tenantId: string, eventId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('calendar_event_completions').delete().eq('tenant_id', tenantId).eq('event_id', eventId);
  if (error) throw error;
}

/** ids dos eventos já marcados como concluídos, dentre os passados — pra cruzar com a lista real do Google Calendar sem 1 query por evento. */
export async function getCompletedEventIds(tenantId: string, eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const db = getDb();
  const { data } = await db
    .from('calendar_event_completions')
    .select('event_id')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds);
  return new Set((data || []).map((row: { event_id: string }) => row.event_id));
}
