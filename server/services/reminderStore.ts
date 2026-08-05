/**
 * Rastreia quais lembretes automáticos já foram enviados (por evento +
 * tipo de lembrete), pra o job de lembretes (server/services/reminderJob.ts)
 * nunca mandar o mesmo lembrete duas vezes mesmo rodando a cada N minutos.
 * Mesmo conceito do jaEnviouLembrete/marcarLembreteEnviado do
 * whatsapp-agent-monique.
 */
const BUCKET = 'app-data';
const OBJECT_PATH = 'sent-reminders.json';

const sentReminders = new Set<string>();
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function initReminderPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as string[];
      for (const key of data) sentReminders.add(key);
    }
  } catch (err) {
    console.warn('⚠️  [Lembretes] Falha ao carregar histórico de envios:', (err as Error).message);
  }
}

function scheduleSave() {
  if (!persistence) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(`${persistence!.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
        method: 'POST',
        headers: {
          apikey: persistence!.supabaseKey,
          Authorization: `Bearer ${persistence!.supabaseKey}`,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(Array.from(sentReminders)),
      });
    } catch (err) {
      console.warn('⚠️  [Lembretes] Falha ao salvar histórico de envios:', (err as Error).message);
    }
  }, 2000);
}

export type ReminderType = 'dia_anterior' | 'mesmo_dia';

function keyFor(eventId: string, type: ReminderType): string {
  return `${eventId}:${type}`;
}

export function wasReminderSent(eventId: string, type: ReminderType): boolean {
  return sentReminders.has(keyFor(eventId, type));
}

export function markReminderSent(eventId: string, type: ReminderType): void {
  sentReminders.add(keyFor(eventId, type));
  scheduleSave();
}
