-- TASK-0172 — achado real em produção (Gladys, tenant Monique, 30/08/2026):
-- server/routes/webhooks.ts cortava o histórico entregue ao autoReply por
-- CONTAGEM (`conversation.messages.slice(0, -messageCount)`), supondo que
-- nada mais foi gravado desde que este lote de mensagens picotadas foi
-- bufferizado. runExclusive (perPhoneQueue.ts) serializa os ciclos de
-- resposta por telefone, mas um ciclo pode ficar preso na fila enquanto o
-- cliente manda MAIS mensagens — que já são gravadas na hora, independente
-- da fila. Quando isso acontece, o corte por contagem pega o lote errado:
-- inclui a própria mensagem deste ciclo (duplicada com o texto que ele já
-- recebe) e perde mensagens novas que já aconteceram de verdade. Corrigido
-- cortando por IDENTIDADE (tudo antes do ID da primeira mensagem deste
-- lote) em vez de por contagem — esta coluna guarda esse ID pra sobreviver
-- a um restart no meio da janela de silêncio (mesmo motivo de
-- last_message_id/texts na 0033).

alter table public.pending_message_buffers
  add column if not exists first_message_id text;
