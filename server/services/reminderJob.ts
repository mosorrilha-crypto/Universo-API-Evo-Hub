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
import { listUpcomingEvents, localNaiveToUtcIso, listConnectedCalendarTenants, type CalendarConfig } from './googleCalendar';
import { listAllAppointments } from './appointmentStore';
import { wasReminderSent, markReminderSent, type ReminderType } from './reminderStore';
import { sendWhatsAppInteractiveButtons } from './metaSend';
import { sendEvolutionTextMessage } from './evolutionSend';
import { resolveCredentialsForTenant } from './tenantResolver';
import { getTenantBusinessHours, getTenantReminderLanguage, type ReminderLanguage } from './tenantProfileStore';

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
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  intervalMs?: number;
}

/** Roda o job de lembretes pra todos os tenants que têm Google Calendar conectado agora (Bloco 2.C). Exportada (não só via startReminderJob/setInterval) pra dar pra chamar direto nos testes. */
export async function checkAndSendReminders(deps: ReminderJobDeps): Promise<void> {
  const cfg = deps.getCalendarConfig();
  if (!cfg?.clientId || !cfg?.clientSecret) return;

  let tenantIds: string[];
  try {
    tenantIds = await listConnectedCalendarTenants();
  } catch (err) {
    console.warn('⚠️  [Lembretes] Falha ao listar tenants com calendário conectado:', (err as Error).message);
    return;
  }

  for (const tenantId of tenantIds) {
    const channel = await resolveCredentialsForTenant(
      tenantId,
      { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId },
      { evolutionApiUrl: deps.evolutionApiUrl, evolutionApiKey: deps.evolutionApiKey, evolutionInstanceName: deps.evolutionInstanceName }
    );
    await checkAndSendRemindersForTenant(tenantId, cfg, channel);
  }
}

async function checkAndSendRemindersForTenant(
  tenantId: string,
  cfg: CalendarConfig,
  channel: {
    // resolveCredentialsForTenant (tenantResolver.ts) nunca devolve
    // 'instagram' hoje — Fase 1 (15/08/2026) não inclui lembrete de
    // agendamento pelo Instagram. Union só precisa incluir o valor pra bater
    // estruturalmente com ResolvedTenant.provider (mesmo tipo devolvido por
    // resolveCredentialsForTenant); o branch abaixo nunca vê 'instagram' na prática.
    provider?: 'meta' | 'evolution' | 'instagram';
    metaAccessToken?: string;
    metaPhoneNumberId?: string;
    evolutionInstanceName?: string;
    evolutionApiUrl?: string;
    evolutionApiKey?: string;
  }
): Promise<void> {
  const today = todayDatePartsInTz();
  const tomorrow = addDays(today, 1);
  const afterTomorrow = addDays(today, 2);
  const todayKey = dayKey(today);
  const tomorrowKey = dayKey(tomorrow);

  const timeMin = localNaiveToUtcIso(`${dayKey(today)}T00:00:00`, BUSINESS_TIMEZONE);
  const timeMax = localNaiveToUtcIso(`${dayKey(afterTomorrow)}T00:00:00`, BUSINESS_TIMEZONE);

  let events;
  try {
    events = await listUpcomingEvents(tenantId, cfg, timeMin, timeMax);
  } catch (err) {
    console.warn('⚠️  [Lembretes] Falha ao listar eventos do Google Calendar:', (err as Error).message);
    return;
  }
  if (!events.length) return;

  const appointmentsByEventId = new Map((await listAllAppointments(tenantId)).map((a) => [a.eventId, a]));

  // Achado real em produção (20/08/2026): o job roda a cada 15min o dia
  // inteiro, e um lembrete "mesmo_dia" era disparado assim que a DATA batia
  // com hoje — sem checar a HORA. Resultado: um agendamento marcado pra
  // hoje disparava "Bom dia! Só confirmando..." no primeiro tick depois da
  // meia-noite (ex: 00:30), horas antes de qualquer horário razoável.
  // Usa o horário de abertura configurado do tenant pra hoje como corte —
  // sem expediente configurado (ou falha ao buscar), cai num horário seguro
  // fixo em vez de travar o lembrete pra sempre.
  const FALLBACK_EARLIEST_HHMM = '07:00';
  const businessHours = await getTenantBusinessHours(tenantId).catch(() => null);
  const todayWeekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
  const earliestHHmm = businessHours?.[String(todayWeekday)]?.open || FALLBACK_EARLIEST_HHMM;
  const { hora: nowHHmm } = dateAndTimeInTz(new Date());
  const language: ReminderLanguage = await getTenantReminderLanguage(tenantId).catch(() => 'es' as ReminderLanguage);

  for (const event of events) {
    const appt = appointmentsByEventId.get(event.id);
    if (!appt) continue;

    const { dateKey: eventDateKey, hora } = dateAndTimeInTz(new Date(event.startIso));
    let type: ReminderType | null = null;
    if (eventDateKey === tomorrowKey) type = 'dia_anterior';
    else if (eventDateKey === todayKey) type = 'mesmo_dia';
    if (!type) continue;
    if (nowHHmm < earliestHHmm) continue; // fora do horário razoável pra mandar — tenta de novo no próximo tick
    if (await wasReminderSent(tenantId, event.id, type)) continue;

    const message = language === 'es'
      ? (type === 'dia_anterior'
        ? `¡Hola! Pasando para recordarte que tu turno es mañana, a las ${hora} 💛`
        : `¡Buen día! Solo confirmando: tu turno es hoy, a las ${hora} 💛`)
      : (type === 'dia_anterior'
        ? `Oi! Passando pra lembrar que seu horário é amanhã, às ${hora} 💛`
        : `Bom dia! Só confirmando: seu horário é hoje, às ${hora} 💛`);
    const buttonLabels = language === 'es'
      ? { confirmar: '✅ Confirmar', remarcar: '🔄 Reprogramar' }
      : { confirmar: '✅ Confirmar', remarcar: '🔄 Remarcar' };

    try {
      if (channel.provider === 'evolution') {
        // Botões interativos são um recurso da Meta Cloud API — a Evolution
        // API (Baileys) não tem o mesmo tipo de mensagem, então cai pro
        // texto simples equivalente.
        await sendEvolutionTextMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, appt.phone, message);
      } else {
        // Achado no benchmark de mercado: a maior causa de no-show é
        // dificuldade de remarcar fora do horário comercial — botões deixam o
        // cliente resolver isso num toque, sem precisar digitar (e sem
        // precisar esperar alguém abrir o WhatsApp comercial pra ler).
        await sendWhatsAppInteractiveButtons(channel.metaPhoneNumberId, channel.metaAccessToken, appt.phone, message, [
          { id: 'lembrete_confirmar', title: buttonLabels.confirmar },
          { id: 'lembrete_remarcar', title: buttonLabels.remarcar },
        ]);
      }
      await markReminderSent(tenantId, event.id, type);
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
