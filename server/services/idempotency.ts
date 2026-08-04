/**
 * Dedupe de mensagens já processadas por message_id, em memória. Evita
 * reprocessar o mesmo áudio se a Meta/Evolution reenviar o mesmo evento
 * (comum em webhooks, que costumam reentregar em caso de timeout).
 *
 * Limitação conhecida: não sobrevive a um restart do processo, e não é
 * compartilhado entre múltiplas instâncias do servidor. Vira redundante
 * (ou é substituído por uma tabela/Redis) quando a Fase 2 trouxer
 * persistência real — ver docs/PLANO-EVOLUCAO.md, item 1.1.7.
 */
const seenMessageIds = new Set<string>();
const MAX_TRACKED_IDS = 5000;

/** Retorna true se essa mensagem já foi processada antes (e marca como vista). */
export function markProcessedIfNew(messageId: string): boolean {
  if (seenMessageIds.has(messageId)) {
    return false;
  }

  if (seenMessageIds.size >= MAX_TRACKED_IDS) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest !== undefined) seenMessageIds.delete(oldest);
  }

  seenMessageIds.add(messageId);
  return true;
}
