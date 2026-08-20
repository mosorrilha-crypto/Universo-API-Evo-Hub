/**
 * Pub/sub em memória pra avisar o painel em tempo real quando uma conversa
 * muda (nova mensagem, arquivar, fixar, apagar, etc.) — ver rota SSE em
 * conversations.ts. Substitui o polling de 8s do frontend por um aviso só
 * quando algo de fato mudou.
 *
 * O evento carrega só o telefone da conversa que mudou (nunca o objeto
 * inteiro) — o frontend reaproveita o mesmo fetch de lista que já usava no
 * polling pra buscar o estado atual, o que também cobre o caso de conversa
 * apagada sem precisar de um formato de evento diferente pra isso.
 *
 * Mesma limitação já aceita em idempotency.ts: em memória, não persiste
 * entre restarts, não é compartilhado entre instâncias. Se o servidor
 * escalar horizontalmente, um cliente conectado à instância A não recebe
 * eventos de escritas processadas na instância B (não é um problema hoje,
 * com uma única instância).
 */
import { EventEmitter } from 'events';

const emitter = new EventEmitter();
// Cada tenant pode ter vários operadores com o painel aberto ao mesmo
// tempo, todos assinando o mesmo evento — sem isso o Node avisa (a partir
// de 11 listeners) achando que é vazamento de memória.
emitter.setMaxListeners(0);

function eventName(tenantId: string): string {
  return `conversation:${tenantId}`;
}

export interface ConversationEventMeta {
  /** Status da resposta automática pra essa conversa — ver emitAiReplyStatus abaixo. Ausente em atualizações comuns (nova mensagem, arquivar, etc.). */
  aiReplyStatus?: 'generating' | 'sent' | 'failed';
}

/** Assina atualizações de conversa de um tenant. Retorna a função de cancelar a assinatura. */
export function subscribeTenant(tenantId: string, listener: (phone: string, meta?: ConversationEventMeta) => void): () => void {
  emitter.on(eventName(tenantId), listener);
  return () => emitter.off(eventName(tenantId), listener);
}

/** Avisa quem estiver assinando esse tenant de que a conversa desse telefone mudou. */
export function emitConversationUpdated(tenantId: string, phone: string): void {
  emitter.emit(eventName(tenantId), phone);
}

/**
 * Pedido real (20/08/2026): o operador via o "digitando..." só do lado do
 * lead (WhatsApp), sem nenhum sinal no próprio painel de que a IA está
 * processando a última mensagem — ficava sem saber se ia chegar resposta em
 * instantes ou se precisava assumir. Avisa o painel em tempo real (mesmo
 * canal SSE de emitConversationUpdated) quando a geração começa
 * ('generating'), termina com sucesso ('sent') ou falha e escala pra um
 * humano ('failed') — ver triggerAutoReply em webhooks.ts e o equivalente em
 * transcriptionQueue.ts (caminho de áudio).
 */
export function emitAiReplyStatus(tenantId: string, phone: string, aiReplyStatus: ConversationEventMeta['aiReplyStatus']): void {
  emitter.emit(eventName(tenantId), phone, { aiReplyStatus });
}
