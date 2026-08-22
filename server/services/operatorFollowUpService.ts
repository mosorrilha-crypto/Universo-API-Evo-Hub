/**
 * Issue #97 — o operador deixa uma orientação no card de escalonamento em
 * vez de assumir a conversa pessoalmente (agora que ele já é notificado de
 * escalonamentos em segundos via push, issue #159). A partir dessa
 * orientação, a IA retoma o atendimento com o cliente:
 *
 * - DENTRO da janela de atendimento de 24h da Meta (desde a última mensagem
 *   do cliente): responde de imediato, texto livre, com base na orientação.
 * - FORA da janela: texto livre não é permitido pela política do WhatsApp —
 *   manda um template aprovado convidando o cliente a responder, e só
 *   quando ele responder de novo (reabrindo a janela) a orientação do
 *   operador é finalmente usada, via o parâmetro operatorGuidance de
 *   generateAutoReplyForText (webhooks.ts consome a pendência a cada nova
 *   mensagem recebida).
 *
 * Nunca inventa dados — a orientação do operador é o que baliza a resposta,
 * a IA só a transforma numa mensagem natural pro cliente.
 */
import type { GoogleGenAI } from '@google/genai';
import { GEMINI_TIMEOUT_MS, withGeminiRetry } from '../gemini';
import { getConversation, recordOutgoingMessage } from './conversationStore';
import { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } from './metaSend';
import { markOperatorGuidanceConsumed, type Escalation } from './escalationStore';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Template aprovado no Meta Business Manager (categoria Utilitário) — corpo sugerido: "Olá {{1}}! Aqui é a equipe do {{2}}, ainda estamos aqui pra te ajudar 😊 Responde essa mensagem quando puder!" — {{1}} nome do lead, {{2}} nome do tenant, nessa ordem. */
const REENGAGEMENT_TEMPLATE_NAME = 'retomada_atendimento';
const REENGAGEMENT_TEMPLATE_LANGUAGE = 'es';

export interface WindowStatus {
  withinWindow: boolean;
  lastLeadMessageAt: string | null;
  /** ISO — quando a janela de 24h fecha (null se o cliente nunca mandou mensagem nesta conversa). */
  windowExpiresAt: string | null;
}

/** Última mensagem do cliente nesta conversa + status da janela de 24h da Meta — usado tanto pelo timer no card de escalonamento quanto pela decisão de texto livre vs template. */
export async function getCustomerServiceWindowStatus(tenantId: string, phone: string): Promise<WindowStatus> {
  const conv = await getConversation(tenantId, phone);
  const leadMessages = (conv?.messages || []).filter((m) => m.sender === 'lead');
  if (!leadMessages.length) return { withinWindow: false, lastLeadMessageAt: null, windowExpiresAt: null };

  const lastLeadMessageAt = leadMessages.reduce((latest, m) => (m.timestamp > latest ? m.timestamp : latest), leadMessages[0].timestamp);
  const expiresAtMs = new Date(lastLeadMessageAt).getTime() + CUSTOMER_SERVICE_WINDOW_MS;
  return {
    withinWindow: Date.now() < expiresAtMs,
    lastLeadMessageAt,
    windowExpiresAt: new Date(expiresAtMs).toISOString(),
  };
}

async function draftFollowUpMessage(tenantId: string, ai: GoogleGenAI, operatorReply: string, contactName: string | undefined): Promise<string> {
  const prompt = `Você é a atendente de WhatsApp de um negócio. Um atendente humano deixou esta orientação sobre como retomar contato com ${contactName || 'um cliente'} que ficou sem resposta: "${operatorReply}"

Escreva UMA mensagem curta, natural e calorosa pro cliente, em espanhol paraguaio (a menos que a orientação esteja claramente noutro idioma — nesse caso, responda no mesmo idioma da orientação), baseada só no que a orientação diz. Não invente nenhum dado (preço, horário, disponibilidade) que não esteja na orientação. Responda só com o texto da mensagem, sem aspas nem comentário.`;

  const response = await withGeminiRetry(
    () =>
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [{ text: prompt }],
      }),
    GEMINI_TIMEOUT_MS
  );
  return (response.text || '').trim();
}

export interface FollowUpDeps {
  ai: GoogleGenAI | null;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  tenantName: string;
}

export type FollowUpOutcome =
  | { sent: true; viaTemplate: false; message: string }
  | { sent: true; viaTemplate: true }
  | { sent: false; reason: string };

/**
 * Chamado assim que o operador submete a orientação (server/routes/conversations.ts,
 * POST /api/escalations/:id/operator-reply). Dentro da janela, já responde
 * de verdade agora. Fora da janela, só manda o convite (template) — a
 * orientação em si fica pendente em escalations.operator_reply até o
 * cliente responder (ver getPendingOperatorGuidance).
 */
export async function sendOperatorGuidedFollowUp(
  tenantId: string,
  escalation: Escalation,
  deps: FollowUpDeps
): Promise<FollowUpOutcome> {
  if (!escalation.operatorReply) return { sent: false, reason: 'Escalonamento sem orientação do operador.' };

  const window = await getCustomerServiceWindowStatus(tenantId, escalation.phone);

  if (!window.withinWindow) {
    if (!deps.metaPhoneNumberId || !deps.metaAccessToken) {
      return { sent: false, reason: 'Credenciais do WhatsApp ausentes — não foi possível mandar o template de reengajamento.' };
    }
    await sendWhatsAppTemplateMessage(
      deps.metaPhoneNumberId,
      deps.metaAccessToken,
      escalation.phone,
      REENGAGEMENT_TEMPLATE_NAME,
      REENGAGEMENT_TEMPLATE_LANGUAGE,
      [escalation.contactName || escalation.phone, deps.tenantName]
    );
    // Não marca a orientação como consumida nem resolve o escalonamento —
    // fica pendente até o cliente responder de novo (webhooks.ts).
    return { sent: true, viaTemplate: true };
  }

  if (!deps.ai) return { sent: false, reason: 'IA indisponível no momento.' };
  const message = await draftFollowUpMessage(tenantId, deps.ai, escalation.operatorReply, escalation.contactName);
  if (!message) return { sent: false, reason: 'IA não conseguiu gerar a mensagem de retomada.' };
  const conversation = await getConversation(tenantId, escalation.phone);
  const safety = await reviewAutoReplyBeforeSend({
    customerMessage: escalation.lastMessage || escalation.operatorReply,
    draftBubbles: [message],
    history: conversation?.messages,
    knowledgeContext: escalation.operatorReply,
  }, { ai: deps.ai });
  if (!safety.approved) {
    console.warn(`🛡️ [Revisor pré-envio] retomada guiada bloqueada para ${escalation.phone}: ${safety.reason}`);
    return { sent: false, reason: `Revisor pré-envio bloqueou o rascunho (${safety.severity}): ${safety.reason}` };
  }

  await sendWhatsAppTextMessage(deps.metaPhoneNumberId, deps.metaAccessToken, escalation.phone, message);
  await recordOutgoingMessage(
    tenantId,
    escalation.phone,
    { type: 'text', text: message, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
    'ai'
  );
  await markOperatorGuidanceConsumed(tenantId, escalation.id);
  console.log(`🤝 [Retomada guiada] tenant=${tenantId} respondeu ${escalation.phone} com base na orientação do operador (dentro da janela de 24h).`);
  return { sent: true, viaTemplate: false, message };
}
