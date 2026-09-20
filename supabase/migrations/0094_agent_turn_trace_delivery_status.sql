-- TASK-0444 (20/09/2026): achado real de auditoria — `agent_turn_traces` só
-- registrava a mensagem de ENTRADA (`message_id`) e um `outcome` solto,
-- gravados ANTES do revisor pré-envio e do envio de verdade rodarem
-- (`generateAutoReplyForText`, autoReply.ts). Não havia como responder "qual
-- decisão do agente produziu exatamente esta bolha enviada?" sem inferência
-- manual cruzando várias tabelas. Estas colunas são preenchidas por uma
-- atualização separada, feita por `webhooks.ts` DEPOIS que o revisor e o
-- envio real terminam (ver `updateAgentTurnTraceOutcome` em
-- agentTurnTraceStore.ts) — o registro inicial (INSERT/UPSERT) continua
-- exatamente como antes, sem essas colunas.

alter table public.agent_turn_traces
  add column if not exists output_message_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(output_message_ids) = 'array'),
  add column if not exists review_status text,
  add column if not exists final_send_status text;
