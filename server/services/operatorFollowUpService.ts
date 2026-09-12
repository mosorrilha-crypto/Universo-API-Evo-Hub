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
import { logEscalation, markOperatorGuidanceConsumed, reviewerEscalationSourceKey, type Escalation } from './escalationStore';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';
import { buildChronologicalConversationContext } from './conversationReplyGuard';
import { HISTORY_WINDOW_SIZE } from './autoReply';
import { getTenantCustomerNotificationPreferences, DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES } from './tenantProfileStore';

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Template aprovado no Meta Business Manager (categoria Utilitário) — corpo sugerido (idioma es, mesmo do tenant real): "¡Hola {{1}}! Somos el equipo de {{2}}, seguimos aquí para ayudarte 😊 ¡Respondé este mensaje cuando puedas!" — {{1}} nome do lead, {{2}} nome do tenant, nessa ordem. */
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

/**
 * TASK-0316 (pedido direto, seguindo o mesmo achado da TASK-0315): esta
 * função nunca recebeu o histórico da conversa — só a orientação livre do
 * operador. Diferente do botão "Sugerir mensagem de retomada" da Ficha IA
 * (rascunho revisável, corrigido na TASK-0315), esta retomada é AUTOMÁTICA
 * — dentro da janela de 24h, o texto gerado aqui vai direto pro cliente
 * sem nenhum operador revisar antes (só o revisor de segurança confere
 * depois, e ele sim já recebia o histórico via `reviewAutoReplyBeforeSend`
 * mais abaixo). Um modelo escrevendo "retomada de contato" sem nunca ter
 * visto do que se tratava a conversa tem uma chance real de soar
 * desconectado do que já foi dito — exatamente o tipo de "fora de
 * contexto" relatado. Mesma janela do agente principal (HISTORY_WINDOW_SIZE)
 * e mesmo formato cronológico numerado (buildChronologicalConversationContext)
 * já usados no resto do projeto.
 */
async function draftFollowUpMessage(tenantId: string, ai: GoogleGenAI, operatorReply: string, contactName: string | undefined, conversationHistory: unknown): Promise<string> {
  const chronologicalHistory = buildChronologicalConversationContext(conversationHistory, HISTORY_WINDOW_SIZE);
  const prompt = `Você é a atendente de WhatsApp de um negócio. Um atendente humano deixou esta orientação sobre como retomar contato com ${contactName || 'um cliente'} que ficou sem resposta: "${operatorReply}"

Escreva UMA mensagem curta, natural e calorosa pro cliente, em espanhol paraguaio (a menos que a orientação esteja claramente noutro idioma — nesse caso, responda no mesmo idioma da orientação), baseada só no que a orientação diz. Não invente nenhum dado (preço, horário, disponibilidade) que não esteja na orientação. Responda só com o texto da mensagem, sem aspas nem comentário.

Histórico cronológico de mensagens desta conversa (as mais antigas podem ter sido omitidas; a numeração recomeça em 1, não é a posição real na conversa completa) — use só pra manter continuidade e nunca repetir/contradizer o que já foi dito, retomar não é a mesma coisa que recomeçar:
${chronologicalHistory}`;

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
  | { sent: false; reason: string; skippedByPreference?: true };

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
    // TASK-0399: tenant pode desligar o convite proativo de reativação —
    // a orientação do operador (`escalation.operatorReply`, já persistida
    // por submitOperatorReply ANTES desta função rodar) nunca se perde: a
    // próxima mensagem do cliente já consome essa orientação via
    // getPendingOperatorGuidance (webhooks.ts), igual acontece hoje quando
    // o template É enviado. Desligar só evita o envio proativo do template
    // enquanto o cliente estiver fora da janela de 24h.
    const notificationPrefs = await getTenantCustomerNotificationPreferences(tenantId).catch(() => DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES);
    if (!notificationPrefs.abandonedConversationReactivation.enabled) {
      return { sent: false, reason: 'Reativação automática desligada em Configurações — a orientação continua salva e será usada assim que o cliente responder.', skippedByPreference: true };
    }
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
  // TASK-0316: buscada ANTES de gerar a mensagem (antes só era buscada
  // depois, pro revisor de segurança) — o prompt que REDIGE a retomada
  // agora também recebe o histórico real, não só quem valida depois.
  const conversation = await getConversation(tenantId, escalation.phone);
  let message: string;
  try {
    message = await draftFollowUpMessage(tenantId, deps.ai, escalation.operatorReply, escalation.contactName, conversation?.messages);
  } catch (error: any) {
    // Achado real (27/08/2026): sem isto, um timeout/erro do Gemini aqui
    // derrubava a requisição inteira com 500 (erro não tratado) — o
    // operador só via um toast genérico de "tente de novo" e a orientação
    // ficava pendente sem nenhum sinal do que de fato aconteceu.
    console.warn(`⚠️ [Retomada guiada] IA falhou ao gerar mensagem para ${escalation.phone}: ${error?.message || error}`);
    return { sent: false, reason: 'A IA demorou demais ou falhou ao gerar a retomada. Tente novamente ou responda manualmente.' };
  }
  if (!message) return { sent: false, reason: 'IA não conseguiu gerar a mensagem de retomada.' };
  const safety = await reviewAutoReplyBeforeSend({
    customerMessage: escalation.lastMessage || escalation.operatorReply,
    draftBubbles: [message],
    history: conversation?.messages,
    knowledgeContext: escalation.operatorReply,
    contactName: escalation.contactName,
  }, { ai: deps.ai });
  if (!safety.approved) {
    console.warn(`🛡️ [Revisor pré-envio] retomada guiada bloqueada para ${escalation.phone}: ${safety.reason}`);
    // Achado real (26/08/2026): sem isto, um bloqueio aqui só aparecia como um
    // toast passageiro no painel — a orientação do operador ficava "pendente"
    // pra sempre e ele não tinha como revisar/editar/enviar o texto que a IA
    // tentou mandar. Reaproveita o mesmo mecanismo do bloqueio normal
    // (mesmo sourceKey do webhooks.ts) pra atualizar este card com o novo
    // rascunho bloqueado, disponível em "Aprovar e enviar".
    await logEscalation(
      tenantId,
      escalation.phone,
      escalation.contactName,
      `Revisor pré-envio bloqueou a retomada guiada pela orientação do operador (${safety.source}, risco ${safety.severity}): ${safety.reason} Rascunho bloqueado: ${message}`,
      escalation.lastMessage || escalation.operatorReply,
      'general',
      { sourceKey: reviewerEscalationSourceKey(escalation.phone), priority: 'high', blockedDraft: message }
    );
    return { sent: false, reason: `Revisor pré-envio bloqueou o rascunho (${safety.severity}): ${safety.reason} Revise em "Aprovar e enviar".` };
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
