/**
 * Dedupe de mensagens já processadas por message_id, compartilhado entre
 * todas as instâncias via a tabela `processed_webhook_messages` (Postgres).
 * Evita reprocessar o mesmo evento se a Meta/Evolution reenviar o mesmo
 * webhook (comum em timeout/erro transitório) — inclusive quando a
 * reentrega cai numa instância do Render diferente da que processou a
 * primeira vez, ou depois de um restart de deploy (achado real: um Set em
 * memória por processo não pegava esse caso, causando respostas duplicadas
 * da IA pra leads reais).
 */
import { getPlatformDb } from './db';
import type { ParsedIncomingMessage } from './webhookParsers';

/**
 * Achado real em produção (11/09/2026, TASK a definir): a migration que
 * criou esta tabela (0025) partia da premissa de que "o message_id do
 * provider (Meta/Evolution) já é globalmente único" — falsa pra Evolution
 * API/Baileys. Duas instâncias Evolution DIFERENTES (logo, dois tenants
 * diferentes) geraram o MESMO `key.id` (`2A96BB17E9619F2244A3`) pra duas
 * mensagens `fromMe` reais e distintas, a ~0,4s de diferença — confirmado
 * nos logs de produção. Como a dedupe era só por `messageId` cru, a segunda
 * entrega a chegar seria descartada como "reentrega" mesmo sendo uma
 * mensagem legítima de outro tenant, perdendo a mensagem (e a mídia
 * associada) silenciosamente, sem nenhum log de erro. A Meta Cloud API
 * garante `wamid` globalmente único (mantido como está); só a Evolution
 * precisa do escopo extra. Instagram usa `instagramAccountId` pelo mesmo
 * motivo (conta, não instância compartilhada).
 */
export function dedupeKeyFor(msg: Pick<ParsedIncomingMessage, 'provider' | 'phoneNumberId' | 'instanceName' | 'instagramAccountId' | 'messageId'>): string {
  const scope = msg.provider === 'evolution' ? msg.instanceName : msg.provider === 'instagram' ? msg.instagramAccountId : msg.phoneNumberId;
  return `${msg.provider}:${scope || ''}:${msg.messageId}`;
}

/** Retorna true se essa mensagem ainda não tinha sido processada (e marca como vista agora). */
export async function markProcessedIfNew(messageId: string): Promise<boolean> {
  const db = getPlatformDb();
  const { error } = await db.from('processed_webhook_messages').insert({ message_id: messageId });
  if (!error) return true;
  if (error.code === '23505') {
    // Já reivindicada por outra chamada (mesma instância ou outra) — reentrega, ignora.
    return false;
  }
  // Falha inesperada de banco (ex: instabilidade transitória do Postgres):
  // prefere processar de novo (pior caso: duplicata ocasional) a perder a
  // mensagem do lead de vez, que seria a consequência de tratar isso como "já vista".
  console.warn(`⚠️  [Idempotência] Falha ao checar/marcar mensagem ${messageId}, processando mesmo assim:`, error.message);
  return true;
}

/**
 * Desfaz a marcação de "já processada" — chamado quando o processamento
 * dessa mensagem falhou de verdade (ex: erro ao gravar no Postgres) ANTES
 * de terminar com sucesso. Sem isso, uma falha transitória marcava a
 * mensagem como "vista" pra sempre; a reentrega da Meta/Evolution (que
 * existe exatamente pra esse cenário) caía no `return false` e a mensagem
 * do lead sumia de vez — nunca era gravada, nunca virava resposta
 * automática, sem nenhum aviso pro operador.
 */
export async function unmarkProcessed(messageId: string): Promise<void> {
  const db = getPlatformDb();
  const { error } = await db.from('processed_webhook_messages').delete().eq('message_id', messageId);
  if (error) {
    console.warn(`⚠️  [Idempotência] Falha ao desmarcar mensagem ${messageId} (reentrega pode não conseguir tentar de novo):`, error.message);
  }
}
