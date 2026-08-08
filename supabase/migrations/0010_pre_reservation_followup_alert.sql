-- Etapa 7 (job de follow-up de pré-reserva) — marca quando o operador já
-- foi alertado sobre uma pré-reserva vencida (committed_date chegou e ainda
-- está pending), pra o job periódico (a cada 15min, mesmo intervalo de
-- reminderJob.ts) nunca gerar um segundo escalonamento duplicado pra mesma
-- pré-reserva.
--
-- NOTA: outras PRs abertas quando esta migration foi criada já usam os
-- números 0007 (PR #54), 0008 (PR #57) e 0009 (PR #58) — pulando pra 0010
-- pra evitar colisão de nome de arquivo entre elas.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.pre_reservations
  add column if not exists followup_alerted_at timestamptz;
