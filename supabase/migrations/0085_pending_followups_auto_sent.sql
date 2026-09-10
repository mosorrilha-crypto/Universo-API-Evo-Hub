-- Reengajamento automático de leads esfriados (pedido real do dono do
-- produto, 10/09/2026): até aqui, pending_followups do tipo 'customer_reply'
-- (IA ofereceu horário/opção e o cliente sumiu) só escalava pro operador
-- humano quando vencia — nunca reabria contato sozinha (decisão anterior,
-- documentada em pendingFollowUpJob.ts). Decisão nova: dentro da janela de
-- 24h da Meta e só entre 7h-19h (horário do negócio, America/Asuncion), a
-- própria IA manda UMA mensagem de reengajamento automática antes de
-- escalar — ver pendingFollowUpStore.ts/pendingFollowUpJob.ts.
--
-- auto_followup_sent_at marca que essa tentativa automática já aconteceu
-- pra este registro — na segunda vez que vencer (due_at empurrado pra
-- frente após o envio), o job escala pro humano direto, sem tentar de novo.
alter table public.pending_followups
  add column if not exists auto_followup_sent_at timestamptz;
