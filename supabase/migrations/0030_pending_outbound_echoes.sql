-- Achado ao vivo em produção: mensagem (texto, áudio ou imagem) mandada
-- direto do celular conectado via Evolution API (fora do nosso painel/IA)
-- ficava invisível pro operador E pro contexto futuro do agente — o webhook
-- fromMe:true da Evolution (que espelha TODA atividade do número, inclusive
-- nosso próprio envio via API) era descartado sem distinção nenhuma, pra
-- evitar duplicar mensagem que a gente já tinha gravado ao enviar.
--
-- Esta tabela guarda uma marca curta ("estou esperando o eco disso") toda
-- vez que enviamos algo real via Evolution API — quando o eco fromMe:true
-- chega, se bater com uma marca aqui, é confirmado como nosso próprio envio
-- (já gravado, descarta o eco); se não bater, foi mandado direto do celular
-- e vira mensagem nova (sentBy='operator'). Ver server/services/outboundEchoTracker.ts.
--
-- Postgres, não memória — mesmo motivo de processed_webhook_messages
-- (idempotency.ts): sobreviver a restart/deploy e funcionar entre
-- instâncias diferentes do Render.

create table if not exists public.pending_outbound_echoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  type text not null check (type in ('text', 'audio', 'image', 'file')),
  text text,
  created_at timestamptz not null default now()
);

create index if not exists pending_outbound_echoes_lookup_idx
  on public.pending_outbound_echoes (tenant_id, phone, type, created_at);

alter table public.pending_outbound_echoes enable row level security;
alter table public.pending_outbound_echoes force row level security;
drop policy if exists tenant_isolation on public.pending_outbound_echoes;
create policy tenant_isolation on public.pending_outbound_echoes
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
