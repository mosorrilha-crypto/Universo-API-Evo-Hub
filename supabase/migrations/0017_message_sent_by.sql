-- Issue #126 — messages.sender só distinguia 'lead' vs 'agent', mas 'agent'
-- cobria tanto resposta automática da IA quanto mensagem digitada manualmente
-- por um operador no painel. Sem essa distinção não dá pra saber depois quem
-- respondeu de verdade (achado real: uma auditoria confundiu uma resposta
-- manual da própria Monique com uma suposta violação de regra da IA).
--
-- sent_by só é preenchido quando sender = 'agent' (nulo pra mensagem de lead).
-- Nullable também pra não quebrar histórico já gravado antes desta migration.

alter table public.messages
  add column if not exists sent_by text check (sent_by in ('ai', 'operator'));
