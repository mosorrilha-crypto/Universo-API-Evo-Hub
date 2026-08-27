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
import { runWithTenantDbContext } from './tenantDbContext';
import { wasReminderSent, markReminderSent, type ReminderType } from './reminderStore';
import { sendWhatsAppTemplateMessage } from './metaSend';
import { sendEvolutionTextMessage } from './evolutionSend';
import { resolveCredentialsForTenant } from './tenantResolver';
import { getTenantReminderLanguage, type ReminderLanguage } from './tenantProfileStore';
import { recordOutgoingMessage } from './conversationStore';
import { startPeriodicJob } from './periodicJob';

// O Paraguai opera atualmente em UTC-3 durante todo o ano. Algumas versões
// de ICU embarcadas no Node ainda aplicam a antiga regra sazonal para
// America/Asuncion em 2026, deslocando lembretes em uma hora. Para o horário
// comercial real deste tenant, usamos o offset IANA fixo UTC-3 explicitamente.
const BUSINESS_TIMEZONE = 'Etc/GMT+3';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Achado real CONFIRMADO em produção (20/08/2026): o lembrete usava
 * mensagem livre com botões (`sendWhatsAppInteractiveButtons`) — só
 * funciona DENTRO da janela de 24h desde a última mensagem do cliente
 * (regra da própria Meta). Teste ao vivo: a Meta devolvia 200 na hora, mas
 * ~4min depois chegava um webhook de status "failed" (código 131047,
 * "Re-engagement message... more than 24 hours have passed") — a mensagem
 * nunca aparecia no celular. Lembrete é por definição proativo (o cliente
 * não acabou de escrever), então só um TEMPLATE aprovado funciona de
 * verdade. Um template por idioma, cada um com 2 botões quick-reply fixos:
 * ES corpo "¡Hola! Pasando para recordarte que tu turno es {{1}}, a las
 * {{2}} 💛" — botões "Confirmar" / "Reprogramar". PT corpo "Oi! Passando
 * pra lembrar que seu horário é {{1}}, às {{2}} 💛" — botões "Confirmar" /
 * "Remarcar". {{1}} = dia (hoy/mañana ou hoje/amanhã conforme o tipo do
 * lembrete), {{2}} = horário.
 */
const REMINDER_TEMPLATE: Record<ReminderLanguage, { name: string; language: string }> = {
  es: { name: 'lembrete_agendamento_es', language: 'es' },
  pt: { name: 'lembrete_agendamento_pt', language: 'pt_BR' },
};

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
    await runWithTenantDbContext({ tenantId, source: 'job' }, async () => {
      const channel = await resolveCredentialsForTenant(
        tenantId,
        { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId },
        { evolutionApiUrl: deps.evolutionApiUrl, evolutionApiKey: deps.evolutionApiKey, evolutionInstanceName: deps.evolutionInstanceName }
      );
      await checkAndSendRemindersForTenant(tenantId, cfg, channel);
    });
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
  //
  // Achado real (27/08/2026): um agendamento feito HOJE pra amanhã disparava
  // o lembrete "dia_anterior" no mesmo tick seguinte à criação (ex: cliente
  // fecha o horário às 15:46, lembrete "amanhã, às X" sai às 16:50) — a
  // cliente recebia esse reforço minutos depois de já ter confirmado o
  // horário na própria conversa, e outro lembrete de manhã no dia do
  // compromisso: duas mensagens de confirmação em poucas horas pro mesmo
  // agendamento. Decisão do dono do produto: só manda o lembrete da véspera
  // pra quem agendou com 72h+ de antecedência (compromisso "fresco" não
  // precisa de reforço na véspera, só a confirmação da manhã do dia).
  const DIA_ANTERIOR_MIN_LEAD_HOURS = 72;
  // Horários fixos por tipo de lembrete (decisão do dono do produto,
  // 27/08/2026) — substituem o corte por horário de abertura do tenant, que
  // servia só pra evitar o lembrete de madrugada.
  const EARLIEST_HHMM_BY_TYPE: Record<ReminderType, string> = { dia_anterior: '08:30', mesmo_dia: '07:30' };
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
    if (nowHHmm < EARLIEST_HHMM_BY_TYPE[type]) continue; // fora do horário definido pra este tipo — tenta de novo no próximo tick
    if (type === 'dia_anterior') {
      const leadHours = (new Date(event.startIso).getTime() - new Date(appt.createdAt).getTime()) / (60 * 60 * 1000);
      if (leadHours < DIA_ANTERIOR_MIN_LEAD_HOURS) continue; // agendado muito perto do compromisso — a confirmação do dia já basta
    }
    if (await wasReminderSent(tenantId, event.id, type)) continue;

    const dayWord = language === 'es'
      ? (type === 'dia_anterior' ? 'mañana' : 'hoy')
      : (type === 'dia_anterior' ? 'amanhã' : 'hoje');
    // Texto livre — só usado no canal Evolution (Baileys não tem o conceito
    // de template aprovado da Meta nem janela de 24h pra contornar).
    const evolutionMessage = language === 'es'
      ? (type === 'dia_anterior'
        ? `¡Hola! Pasando para recordarte que tu turno es mañana, a las ${hora} 💛`
        : `¡Buen día! Solo confirmando: tu turno es hoy, a las ${hora} 💛`)
      : (type === 'dia_anterior'
        ? `Oi! Passando pra lembrar que seu horário é amanhã, às ${hora} 💛`
        : `Bom dia! Só confirmando: seu horário é hoje, às ${hora} 💛`);

    try {
      let messageId: string | undefined;
      if (channel.provider === 'evolution') {
        // Botões interativos/template são um recurso da Meta Cloud API — a
        // Evolution API (Baileys) não tem o mesmo conceito, então cai pro
        // texto simples equivalente.
        await sendEvolutionTextMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, appt.phone, evolutionMessage);
      } else {
        // Achado no benchmark de mercado: a maior causa de no-show é
        // dificuldade de remarcar fora do horário comercial — botões deixam o
        // cliente resolver isso num toque, sem precisar digitar (e sem
        // precisar esperar alguém abrir o WhatsApp comercial pra ler).
        const template = REMINDER_TEMPLATE[language];
        const result = await sendWhatsAppTemplateMessage(
          channel.metaPhoneNumberId,
          channel.metaAccessToken,
          appt.phone,
          template.name,
          template.language,
          [dayWord, hora],
          ['lembrete_confirmar', 'lembrete_remarcar']
        );
        messageId = result?.messageId;
      }
      await markReminderSent(tenantId, event.id, type);
      // Achado real (27/08/2026): o lembrete nunca era gravado na conversa —
      // sumia do histórico que o painel mostra e do contexto que o agente
      // recompõe se for reativado depois (autoReply.ts lê conversation.messages).
      // `evolutionMessage` já é o texto equivalente ao aprovado no template
      // Meta (mesmo corpo, mesmos parâmetros), então serve como registro em
      // qualquer canal.
      await recordOutgoingMessage(
        tenantId,
        appt.phone,
        { type: 'text', text: evolutionMessage, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
        'ai'
      ).catch((err) => console.warn(`⚠️  [Lembretes] Falha ao gravar lembrete no histórico de ${appt.phone}:`, (err as Error).message));
      // `messageId` (wamid) fica no log só pra poder cruzar depois com um
      // eventual status "failed" que chega via webhook (webhooks.ts) —
      // achado real (20/08/2026): sem isso não tinha como confirmar se um
      // lembrete "enviado com sucesso" (200 da Meta) chegou de verdade.
      console.log(`⏰ [Lembretes] Enviado (${type}) pra ${appt.phone} — evento ${event.id}${messageId ? ` — wamid=${messageId}` : ''}`);
    } catch (err) {
      console.warn(`⚠️  [Lembretes] Falha ao enviar pra ${appt.phone}:`, (err as Error).message);
    }
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min). */
export function startReminderJob(deps: ReminderJobDeps): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'lembretes',
    intervalMs,
    () => checkAndSendReminders(deps),
    (err) => console.warn('⚠️  [Lembretes] Erro no job:', err instanceof Error ? err.message : String(err)),
  );
}
