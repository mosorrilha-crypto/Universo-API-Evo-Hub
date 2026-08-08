-- Organização de conversas no painel do operador — arquivar, fixar no topo,
-- marcar como não lida manualmente, silenciar notificações. Nada disso
-- reflete no WhatsApp real via Meta Cloud API — são metadados só do painel,
-- igual às ações de mensagem (ver 0006_message_actions.sql).
--
-- NOTA: a PR #54 (aberta como rascunho, ainda não mergeada quando esta
-- migration foi criada) também mexe em `conversations` — adiciona
-- `last_read_at` pra contagem automática de não lidas. Esta migration usa
-- nomes de coluna diferentes e não depende dela: `manually_unread` aqui é só
-- o override manual do operador ("marcar como não lida" no menu ⋮),
-- independente da lógica automática. Pode precisar reconciliar as duas
-- quando ambas as PRs mergearem (ex: unread = manually_unread || detecção
-- automática via last_read_at).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.conversations
  add column if not exists archived_at timestamptz,
  add column if not exists pinned_at timestamptz,
  add column if not exists muted boolean not null default false,
  add column if not exists manually_unread boolean not null default false;
