-- TASK-0368 (pedido direto, exemplo real com print da conversa da Pamela):
-- o painel rotulava toda mensagem digitada por um operador só como "Você
-- (equipe)"/"Escrita por você", sem dizer QUAL operador — em tenant com mais
-- de um atendente isso não ajuda a saber quem escreveu o quê. Snapshot do
-- nome no momento do envio (não um join ao vivo com `operators`) — continua
-- mostrando o nome certo mesmo que o operador seja renomeado ou removido
-- depois, igual o resto do histórico de uma conversa de WhatsApp real nunca
-- muda retroativamente.
alter table public.messages
  add column if not exists operator_name text;
