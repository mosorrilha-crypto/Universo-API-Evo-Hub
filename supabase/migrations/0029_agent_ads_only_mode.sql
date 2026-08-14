-- Pedido real do usuário (14/08/2026): a Monique tem dois números ligados
-- (o pessoal dela, conectado temporariamente pra não perder mensagens
-- enquanto ganham confiança no número dedicado do agente, e o número do
-- agente em si). Precisa de uma chave por tenant pra, quando ativada, o
-- agente só responder automaticamente contatos identificados como vindos
-- de anúncio (ctwa_clid gravado na conversa) — nunca contatos pessoais
-- dela. Mensagem continua sendo gravada normalmente (nunca perde dado),
-- só a resposta automática é que fica em silêncio nesse caso.
--
-- Mesma tabela de status do agente (active/paused/restricted) — é um flag
-- ortogonal a esse enum, não um 4º status.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.agent_status
  add column if not exists ads_only boolean not null default false;
