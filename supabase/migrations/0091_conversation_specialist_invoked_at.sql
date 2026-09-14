-- TASK-0416 — separa "history vazio" (usado até aqui pela rede de segurança
-- "1ª mensagem sempre responde" do modo leadsOnly, TASK-0411/0412) de "1ª
-- vez que o especialista (generateSpecialistReply) rodou de verdade" nesta
-- conversa. Achado real: quando o tenant tem uma Mensagem de Primeiro
-- Contato fixa (firstContactBlocks, nunca gerada pela IA) ou quando um
-- operador escreve antes de qualquer lead, history.length===0 nunca é
-- verdade na 1ª vez que o especialista roda de verdade — a rede de
-- segurança nunca disparava nesses casos.
alter table public.conversations
  add column if not exists specialist_invoked_at timestamptz null;
