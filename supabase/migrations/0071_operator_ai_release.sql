-- TASK-0181 (parte 2) — achado real relatado pelo dono do produto (01/09/2026):
-- o gate "operador ativo = IA cede a vez" (TASK-0177) usa a última mensagem
-- do operador pra pausar a IA por 5min. Numa conversa em que o operador
-- responde manualmente várias vezes seguidas (ex: contato pessoal que também
-- é cliente) e a cliente responde de novo dentro da janela, cada resposta do
-- operador RENOVA os 5min — a IA nunca recupera a vez sozinha e o operador
-- não tinha nenhum jeito de liberar isso na hora, só esperar o contato ficar
-- quieto por 5min inteiros.
--
-- Esta coluna guarda quando o operador pediu explicitamente pra devolver o
-- controle pra IA agora. O gate em webhooks.ts passa a ignorar a pausa
-- automática quando este timestamp for mais recente que a última mensagem
-- manual do operador nesta conversa (ver server/services/conversationStore.ts,
-- updateConversationState com releaseAiNow).
alter table if exists conversations
  add column if not exists operator_ai_release_at timestamptz;
