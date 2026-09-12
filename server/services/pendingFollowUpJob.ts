/**
 * Job de acompanhamento de funil (pedido real, 15/08/2026 — auditoria de
 * conversas reais do dia mostrou ZERO agendamentos fechados apesar de 31
 * conversas ativas). Duas situações que hoje deixavam um lead esfriar sem
 * ninguém saber, marcadas em server/services/pendingFollowUpStore.ts:
 *
 * - 'owner_review': a IA pediu uma foto/dado pra Monique avaliar (trabalho
 *   anterior, pigmento antigo) antes de definir o procedimento, e ainda não
 *   tem a decisão dela. Vence no fim do dia útil. Continua só escalando pro
 *   operador — nunca é a IA quem decide isso.
 *
 * - 'customer_reply': a IA ofereceu horário/opção e o cliente sumiu antes de
 *   responder. Vence ~2h30 depois. ★ Mudança de comportamento (pedido real
 *   do dono do produto, 10/09/2026): antes disso, nunca reabria contato
 *   sozinho — só escalava. Agora, dentro da janela de 24h de atendimento da
 *   Meta E só entre 7h-19h (horário do negócio, America/Asuncion), a IA
 *   manda UMA mensagem de reengajamento automática antes de escalar. Se
 *   vencer fora dessa janela de horário, espera até o próximo tick dentro
 *   dela (ou até a janela de 24h fechar, o que vier primeiro). Depois dessa
 *   única tentativa, se o cliente continuar em silêncio, escala pro
 *   operador — nunca insiste uma segunda vez sozinha.
 */
import type { GoogleGenAI } from '@google/genai';
import { GEMINI_TIMEOUT_MS, withGeminiRetry } from '../gemini';
import {
  listTenantIdsWithPendingFollowUps,
  listPendingFollowUps,
  markFollowUpAlerted,
  markAutoFollowUpSent,
  type PendingFollowUp,
} from './pendingFollowUpStore';
import { logEscalation } from './escalationStore';
import { startPeriodicJob } from './periodicJob';
import { runWithTenantDbContext } from './tenantDbContext';
import { getConversation, recordOutgoingMessage } from './conversationStore';
import { isAgentPaused } from './agentStatus';
import { getCustomerServiceWindowStatus } from './operatorFollowUpService';
import {
  getTenantReminderLanguage,
  getTenantCustomerNotificationPreferences,
  funnelAutoFollowUpDelayMs,
  DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES,
  type ReminderLanguage,
  type FunnelAutoFollowUpPreferences,
} from './tenantProfileStore';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';
import { resolveCredentialsForTenant } from './tenantResolver';
import { sendWhatsAppTextMessage } from './metaSend';
import { sendEvolutionTextMessage } from './evolutionSend';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const BUSINESS_TIMEZONE = 'America/Asuncion';
/**
 * TASK-0399 (12/09/2026): o prazo (era `CUSTOMER_REPLY_FOLLOWUP_MS` fixo em
 * 2.5h) e a janela de horário (eram `AUTO_FOLLOWUP_START_HOUR`/`_END_HOUR`
 * fixos em 7-19) agora vêm de `customer_notification_preferences.funnelAutoFollowUp`
 * por tenant (migration 0089) — o default reproduz exatamente esses mesmos
 * valores. `server/routes/webhooks.ts` usa a MESMA preferência ao criar a
 * pendência inicial (`funnelAutoFollowUpDelayMs`), senão o prazo inicial e o
 * prazo recalculado aqui divergiriam assim que um tenant customizasse o valor.
 */

function reasonForAlert(p: PendingFollowUp): string {
  if (p.kind === 'owner_review') {
    return `Cliente esperando avaliação antes de definir o procedimento (${p.reason}) — ainda sem decisão até o fim do dia.`;
  }
  if (p.autoFollowUpSentAt) {
    return `Ofereceu horário/opção, a IA já tentou reengajar automaticamente (${p.reason}) e o cliente continua sem responder — precisa de atenção humana.`;
  }
  return `Ofereceu horário/opção e o cliente sumiu sem responder (${p.reason}) — esfriou, pode precisar de um empurrãozinho.`;
}

/** true se `now` cai dentro da janela [start, end) no fuso do negócio — janela em que a IA pode mandar reengajamento automático. */
function isWithinAutoFollowUpHours(now: Date, startHour: number, endHour: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, hour: '2-digit', hour12: false }).format(now)
  );
  return hour >= startHour && hour < endHour;
}

async function draftAutomaticFollowUpMessage(ai: GoogleGenAI, reason: string, contactName: string | undefined, language: ReminderLanguage): Promise<string> {
  const languageInstruction = language === 'pt' ? 'português brasileiro' : 'espanhol paraguaio';
  const prompt = `Você é a assistente de WhatsApp de um estúdio de beleza. Uma cliente chamada ${contactName || 'uma cliente'} recebeu esta oferta/opção e ficou sem responder: "${reason}"

Escreva UMA mensagem curta pra retomar contato de forma calorosa, proativa e um pouco persuasiva — sem parecer robótica nem insistente. Pode reforçar brevemente o valor (ex: atendimento individual, resultado natural) ou criar um leve senso de close (ex: perguntar se ainda tem interesse, oferecer ajudar a decidir), mas SEM inventar nenhum dado novo (preço, horário, disponibilidade, desconto) que não esteja no texto acima, e SEM prometer resultado garantido ou prazo de duração específico. Responda em ${languageInstruction}, só com o texto da mensagem, sem aspas nem comentário.`;

  const response = await withGeminiRetry(
    () => ai.models.generateContent({ model: 'gemini-3.6-flash', contents: [{ text: prompt }] }),
    GEMINI_TIMEOUT_MS
  );
  return (response.text || '').trim();
}

export interface PendingFollowUpJobDeps {
  intervalMs?: number;
  getAi?: () => GoogleGenAI | null;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
}

type AutomaticFollowUpResult = 'sent' | 'escalate' | 'wait';

/**
 * Tenta reengajar automaticamente UMA vez. Devolve:
 * - 'sent': mandou a mensagem — o chamador NÃO escala agora (due_at já foi
 *   empurrado pra frente, só escala se o cliente continuar em silêncio).
 * - 'wait': só está fora da janela de horário configurada agora — o
 *   chamador NÃO escala, deixa a pendência como está pro próximo tick
 *   dentro do horário.
 * - 'escalate': qualquer outro caso (sem IA/credencial, janela de 24h da
 *   Meta já fechada — só se aplica pro canal Meta, ver TASK-0400 — cliente
 *   pausado/bloqueado, revisor de segurança bloqueou, ou falha de envio) —
 *   o chamador escala pro operador, exatamente como antes.
 */
async function tryAutomaticFollowUp(
  tenantId: string,
  p: PendingFollowUp,
  deps: PendingFollowUpJobDeps,
  followUpPrefs: FunnelAutoFollowUpPreferences,
  language: ReminderLanguage
): Promise<AutomaticFollowUpResult> {
  if (!followUpPrefs.enabled) return 'escalate'; // tenant desligou o reengajamento automático — reaproveita o fallback que já existia

  const ai = deps.getAi?.();
  if (!ai) return 'escalate';

  if (await isAgentPaused(tenantId)) return 'escalate';

  const conversation = await getConversation(tenantId, p.phone);
  if (conversation?.aiBlockedAt) return 'escalate';
  if (conversation?.geoRestriction) return 'escalate';

  // TASK-0400 (achado real: os tenants reais hoje, Daniel e Monique, usam
  // Evolution, não Meta): a janela de 24h é uma regra específica da Meta
  // Cloud API — resolve o canal PRIMEIRO e só aplica essa checagem quando
  // o canal de fato é Meta, senão um tenant Evolution com o cliente calado
  // há mais de 24h escalava sem necessidade, mesmo podendo responder texto
  // livre a qualquer momento nesse canal.
  const channel = await resolveCredentialsForTenant(
    tenantId,
    { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId },
    { evolutionApiUrl: deps.evolutionApiUrl, evolutionApiKey: deps.evolutionApiKey, evolutionInstanceName: deps.evolutionInstanceName }
  );
  if (channel.provider === 'instagram') return 'escalate'; // Instagram não tem esse fluxo ainda

  if (channel.provider === 'meta') {
    const window = await getCustomerServiceWindowStatus(tenantId, p.phone);
    if (!window.withinWindow) return 'escalate'; // fora da janela de 24h da Meta — texto livre não é permitido, cai pro escalonamento normal
  }

  if (!isWithinAutoFollowUpHours(new Date(), followUpPrefs.businessHoursStart, followUpPrefs.businessHoursEnd)) return 'wait'; // fora da janela configurada — espera o próximo tick dentro da janela de 24h

  let message: string;
  try {
    message = await draftAutomaticFollowUpMessage(ai, p.reason, p.contactName, language);
  } catch (error: any) {
    console.warn(`⚠️  [Reengajamento automático] tenant=${tenantId} IA falhou ao gerar mensagem pra ${p.phone}: ${error?.message || error}`);
    return 'escalate';
  }
  if (!message) return 'escalate';

  const safety = await reviewAutoReplyBeforeSend(
    { customerMessage: p.reason, draftBubbles: [message], history: conversation?.messages, knowledgeContext: p.reason },
    { ai }
  );
  if (!safety.approved) {
    console.warn(`🛡️  [Reengajamento automático] tenant=${tenantId} revisor pré-envio bloqueou o reengajamento pra ${p.phone} (${safety.severity}): ${safety.reason}`);
    return 'escalate';
  }

  try {
    if (channel.provider === 'evolution') {
      await sendEvolutionTextMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, p.phone, message);
    } else {
      await sendWhatsAppTextMessage(channel.metaPhoneNumberId, channel.metaAccessToken, p.phone, message);
    }
  } catch (error: any) {
    console.warn(`⚠️  [Reengajamento automático] tenant=${tenantId} falha ao enviar pra ${p.phone}: ${error?.message || error}`);
    return 'escalate';
  }

  await recordOutgoingMessage(
    tenantId,
    p.phone,
    { type: 'text', text: message, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
    'ai'
  );
  await markAutoFollowUpSent(tenantId, p.id, new Date(Date.now() + funnelAutoFollowUpDelayMs(followUpPrefs)).toISOString());
  console.log(`🤝 [Reengajamento automático] tenant=${tenantId} reengajou ${p.phone} sozinha (motivo: ${p.reason}).`);
  return 'sent';
}

async function checkPendingFollowUpsForTenant(tenantId: string, nowIso: string, deps: PendingFollowUpJobDeps): Promise<void> {
  let pending: PendingFollowUp[];
  try {
    pending = await listPendingFollowUps(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Acompanhamento de funil] tenant=${tenantId} falha ao listar pendências:`, (err as Error).message);
    return;
  }

  // TASK-0399: busca UMA vez por tenant por tick (não por item pendente) —
  // corrige de quebra um N+1 real que já existia aqui (getTenantReminderLanguage
  // rodava dentro de tryAutomaticFollowUp, ou seja, uma vez por item).
  const [followUpPrefs, language] = await Promise.all([
    getTenantCustomerNotificationPreferences(tenantId)
      .then((prefs) => prefs.funnelAutoFollowUp)
      .catch(() => DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.funnelAutoFollowUp),
    getTenantReminderLanguage(tenantId).catch(() => 'es' as ReminderLanguage),
  ]);

  for (const p of pending) {
    if (p.dueAt > nowIso) continue; // ainda não venceu

    try {
      if (p.kind === 'customer_reply' && !p.autoFollowUpSentAt) {
        const result = await tryAutomaticFollowUp(tenantId, p, deps, followUpPrefs, language);
        if (result === 'sent') continue; // due_at foi empurrado pra frente, só escala se continuar em silêncio
        if (result === 'wait') continue; // fora da janela configurada — tenta de novo no próximo tick, sem escalar ainda
      }
      await logEscalation(tenantId, p.phone, p.contactName, reasonForAlert(p), undefined, p.kind);
      await markFollowUpAlerted(tenantId, p.id);
      console.log(`🔔 [Acompanhamento de funil] tenant=${tenantId} escalou ${p.kind} pra ${p.phone} (pendente desde ${p.createdAt}).`);
    } catch (err) {
      console.warn(`⚠️  [Acompanhamento de funil] tenant=${tenantId} falha ao processar pendência ${p.id}:`, (err as Error).message);
    }
  }
}

/** Uma passada do job — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkPendingFollowUps(deps: PendingFollowUpJobDeps = {}): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithPendingFollowUps();
  } catch (err) {
    console.warn('⚠️  [Acompanhamento de funil] Falha ao listar tenants com pendência:', (err as Error).message);
    return;
  }
  const nowIso = new Date().toISOString();
  for (const tenantId of tenantIds) {
    await runWithTenantDbContext({ tenantId, source: 'job' }, () => checkPendingFollowUpsForTenant(tenantId, nowIso, deps));
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startPreReservationFollowUpJob. */
export function startPendingFollowUpJob(deps: PendingFollowUpJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'acompanhamento-funil',
    intervalMs,
    () => checkPendingFollowUps(deps),
    (err) => console.warn('⚠️  [Acompanhamento de funil] Erro no job:', err instanceof Error ? err.message : String(err)),
  );
}
