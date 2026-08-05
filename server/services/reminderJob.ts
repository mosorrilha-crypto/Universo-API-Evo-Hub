/**
 * Lembretes automáticos de agendamento — job periódico que verifica a agenda
 * real (Google Calendar) e manda um WhatsApp pro cliente na véspera e no dia
 * do horário marcado. Mesmo conceito do send-reminders.js do
 * whatsapp-agent-monique (jaEnviouLembrete/marcarLembreteEnviado evita
 * duplicar envio a cada execução do job).
 *
 * Só alcança agendamentos criados pelo próprio agente (server/services/autoReply.ts
 * + appointmentStore.ts) — um evento criado manualmente direto no Google
 * Calendar não tem telefone associado, então não tem como avisar por WhatsApp.
 */
import { listUpcomingEvents, localNaiveToUtcIso, isGoogleCalendarConnected, type CalendarConfig } from './googleCalendar';
import { listAllAppointments } from './appointmentStore';
import { wasReminderSent, markReminderSent, type ReminderType } from './reminderStore';
import { sendWhatsAppTextMessage } from './metaSend';

const BUSINESS_TIMEZONE = 'America/Asuncion';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function todayDatePartsInTz(): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function addDays(p: DateParts, delta: number): DateParts {
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function dayKey(p: DateParts): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function dateAndTimeInTz(date: Date): { dateKey: string; hora: string } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { dateKey: `${map.year}-${map.month}-${map.day}`, hora: `${map.hour}:${map.minute}` };
}

export interface ReminderJobDeps {
  getCalendarConfig: () => CalendarConfig | undefined;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  intervalMs?: number;
}

async function checkAndSendReminders(deps: ReminderJobDeps): Promise<void> {
  const cfg = deps.getCalendarConfig();
  if (!cfg?.clientId || !cfg?.clientSecret) return;
  if (!(await isGoogleCalendarConnected())) return;

  const today = todayDatePartsInTz();
  const tomorrow = addDays(today, 1);
  const afterTomorrow = addDays(today, 2);
  const todayKey = dayKey(today);
  const tomorrowKey = dayKey(tomorrow);

  const timeMin = localNaiveToUtcIso(`${dayKey(today)}T00:00:00`, BUSINESS_TIMEZONE);
  const timeMax = localNaiveToUtcIso(`${dayKey(afterTomorrow)}T00:00:00`, BUSINESS_TIMEZONE);

  let events;
  try {
    events = await listUpcomingEvents(cfg, timeMin, timeMax);
  } catch (err) {
    console.warn('⚠️  [Lembretes] Falha ao listar eventos do Google Calendar:', (err as Error).message);
    return;
  }
  if (!events.length) return;

  const appointmentsByEventId = new Map(listAllAppointments().map((a) => [a.eventId, a]));

  for (const event of events) {
    const appt = appointmentsByEventId.get(event.id);
    if (!appt) continue;

    const { dateKey: eventDateKey, hora } = dateAndTimeInTz(new Date(event.startIso));
    let type: ReminderType | null = null;
    if (eventDateKey === tomorrowKey) type = 'dia_anterior';
    else if (eventDateKey === todayKey) type = 'mesmo_dia';
    if (!type) continue;
    if (wasReminderSent(event.id, type)) continue;

    const message = type === 'dia_anterior'
      ? `Oi! Passando pra lembrar que seu horário é amanhã, às ${hora} 💛 Qualquer coisa me chama por aqui!`
      : `Bom dia! Só confirmando: seu horário é hoje, às ${hora} 💛 Te esperamos!`;

    try {
      await sendWhatsAppTextMessage(deps.metaPhoneNumberId, deps.metaAccessToken, appt.phone, message);
      markReminderSent(event.id, type);
      console.log(`⏰ [Lembretes] Enviado (${type}) pra ${appt.phone} — evento ${event.id}`);
    } catch (err) {
      console.warn(`⚠️  [Lembretes] Falha ao enviar pra ${appt.phone}:`, (err as Error).message);
    }
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min). */
export function startReminderJob(deps: ReminderJobDeps): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = () => checkAndSendReminders(deps).catch((err) => console.warn('⚠️  [Lembretes] Erro no job:', err.message));
  run();
  setInterval(run, intervalMs);
}
