-- TASK-0185 (parte 2) — pedido real do dono do produto: a coluna "Interesse"
-- do backup em Google Sheets precisa refletir o serviço que a cliente pediu
-- de verdade, não só o título do anúncio (adHeadline, que só existe pra
-- lead vindo de Meta Ads). O especialista já classifica isso a cada turno
-- (campo "servicoInteresse", server/services/autoReply.ts); esta coluna
-- guarda o valor mais recente por conversa, sempre sobrescrita quando um
-- novo interesse é captado (diferente de `name`, que é fixo uma vez sabido).
alter table if exists conversations
  add column if not exists interest text;
