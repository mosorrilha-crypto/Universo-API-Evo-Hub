import type { StoredConversation } from './conversationStore';

/**
 * Achado real (pedido do dono do produto, 30/08/2026; achado de novo,
 * tenant Monique, "Ninfa Oviedo", 17/09/2026): quando o operador está
 * respondendo manualmente AO VIVO, a IA cede a vez por 5min (ver comentário
 * completo no 1º uso, abaixo) — mas essa checagem só rodava UMA vez, com o
 * snapshot da conversa capturado ANTES de chamar o Gemini. Se o operador
 * mandar uma mensagem manual DURANTE a geração (alguns segundos de Gemini +
 * digitação simulada), a resposta da IA sai de qualquer jeito quando
 * termina — cruzando por cima do que o operador já respondeu ao vivo
 * (reproduzido na conversa real da Ninfa 3 vezes na mesma troca: a
 * operadora chegou a se desculpar dizendo "Te contestó el assistente").
 * Extraída aqui pra poder ser chamada de novo, com um snapshot FRESCO da
 * conversa, bem antes do envio (ver TASK-0428 em triggerAutoReply).
 */
export function isOperatorActivelyEngaged(conversation: StoredConversation | undefined): boolean {
  const OPERATOR_ACTIVE_PAUSE_MS = 5 * 60 * 1000;
  const lastOperatorMessage = [...(conversation?.messages || [])]
    .reverse()
    .find((m) => m.sender === 'agent' && m.sentBy === 'operator');
  if (!lastOperatorMessage) return false;
  const releasedAfterLastOperatorMessage = conversation?.operatorAiReleaseAt
    && new Date(conversation.operatorAiReleaseAt).getTime() >= new Date(lastOperatorMessage.timestamp).getTime();
  return Date.now() - new Date(lastOperatorMessage.timestamp).getTime() < OPERATOR_ACTIVE_PAUSE_MS && !releasedAfterLastOperatorMessage;
}

