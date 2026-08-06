/**
 * Rastreia quais lembretes automáticos já foram enviados (por evento + tipo
 * de lembrete), pra o job de lembretes (server/services/reminderJob.ts)
 * nunca mandar o mesmo lembrete duas vezes. Migrado pra tabela Postgres
 * `sent_reminders` (Bloco 2.A), particionada por tenant_id.
 */
import { getDb } from './db';

export type ReminderType = 'dia_anterior' | 'mesmo_dia';

export async function wasReminderSent(tenantId: string, eventId: string, type: ReminderType): Promise<boolean> {
  const db = getDb();
  const { data } = await db
    .from('sent_reminders')
    .select('event_id')
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('reminder_type', type)
    .maybeSingle();
  return !!data;
}

export async function markReminderSent(tenantId: string, eventId: string, type: ReminderType): Promise<void> {
  const db = getDb();
  await db
    .from('sent_reminders')
    .upsert({ tenant_id: tenantId, event_id: eventId, reminder_type: type }, { onConflict: 'tenant_id,event_id,reminder_type' });
}
