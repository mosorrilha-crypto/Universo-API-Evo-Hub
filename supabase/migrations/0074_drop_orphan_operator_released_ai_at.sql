-- Limpeza de drift real (TASK-0180, auditado após ficar duplicado pela
-- TASK-0181): a coluna operator_released_ai_at foi aplicada em produção via
-- apply_migration (histórico do Supabase: conversations_operator_released_ai_pause,
-- 31/08/2026) como parte de um fix pro mesmo bug que a TASK-0181 resolveu de
-- forma independente e já mesclada (coluna operator_ai_release_at). O código
-- que usaria essa coluna nunca chegou a ser commitado no repositório — ela
-- ficou órfã em produção, sem migration correspondente neste repo e sem
-- nenhuma referência no código (sinalizada como drift não explicado no
-- registro da TASK-0181). Removendo pra não confundir auditorias futuras com
-- duas colunas quase-idênticas fazendo a mesma coisa.
alter table if exists conversations
  drop column if exists operator_released_ai_at;
