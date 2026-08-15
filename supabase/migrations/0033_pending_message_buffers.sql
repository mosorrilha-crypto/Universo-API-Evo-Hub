-- Achado real em produção (15/08/2026): o buffer de rajada de mensagens
-- picotadas (server/services/messageBuffer.ts, agrupa 2-3 mensagens rápidas
-- seguidas antes de disparar a resposta automática, ~6s de silêncio) vivia
-- só em memória (Map por processo). Um restart de deploy no meio dessa
-- janela de 6s perdia a mensagem inteira: o timer nunca disparava de novo,
-- e o cliente ficava sem resposta nenhuma, silenciosamente.
--
-- Esta tabela guarda o estado atual de cada buffer em aberto — o timer em
-- memória continua sendo o caminho rápido pro caso comum (sem round-trip de
-- banco no meio da janela); isto só existe pra um sweeper periódico
-- recuperar qualquer marca cujo horário de disparo já passou e ninguém
-- tratou na instância atual (server/services/messageBuffer.ts,
-- startBufferRecoverySweeper). Mesmo motivo de pending_outbound_echoes
-- (0030): Postgres, não memória, pra sobreviver a restart/deploy.
--
-- Chave composta (tenant_id, phone), não só phone — achado ao escrever esta
-- migration: o mesmo número de telefone pode falar com dois tenants
-- diferentes da plataforma (cenário real e possível), e a versão em memória
-- antiga já tinha esse mesmo risco de colisão (corrigido junto).

create table if not exists public.pending_message_buffers (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  texts jsonb not null,
  contact_name text,
  last_message_id text not null,
  resolved_tenant jsonb not null,
  flush_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

create index if not exists pending_message_buffers_flush_at_idx
  on public.pending_message_buffers (flush_at);

alter table public.pending_message_buffers enable row level security;
alter table public.pending_message_buffers force row level security;
drop policy if exists tenant_isolation on public.pending_message_buffers;
create policy tenant_isolation on public.pending_message_buffers
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
