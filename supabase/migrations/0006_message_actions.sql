-- Ações de mensagem no painel do operador — responder (quote), encaminhar,
-- reagir, editar. WhatsAppLeadsSim.tsx hoje só manda/apaga mensagem; falta
-- o metadado pra suportar as ações que o WhatsApp real tem em cada balão.
--
-- IMPORTANTE: nada disso reflete de volta pro WhatsApp real via Meta Cloud
-- API (a Meta não expõe editar/reagir a mensagem já enviada do jeito que o
-- app WhatsApp faz) — são metadados só do nosso painel, pra o operador se
-- organizar.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.messages
  add column if not exists reply_to_message_id text,
  add column if not exists forwarded_from_message_id text,
  add column if not exists edited_at timestamptz,
  add column if not exists reactions jsonb;
