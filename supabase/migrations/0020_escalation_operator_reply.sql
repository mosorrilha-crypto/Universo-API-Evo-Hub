-- Issue #97 — operador responde dentro do card de escalonamento em vez de
-- assumir a conversa pessoalmente; a IA usa essa resposta como orientação
-- pra continuar o atendimento. Ver server/services/escalationStore.ts
-- (submitOperatorReply) e server/services/operatorFollowUpService.ts.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.escalations
  add column if not exists operator_reply text,
  add column if not exists operator_reply_at timestamptz,
  -- null enquanto a orientação ainda não foi usada numa resposta real pro
  -- cliente (ex: fora da janela de 24h, esperando o cliente responder o
  -- template de reengajamento primeiro). Preenchido quando a IA finalmente
  -- usa a orientação numa mensagem enviada de verdade.
  add column if not exists operator_reply_consumed_at timestamptz;
