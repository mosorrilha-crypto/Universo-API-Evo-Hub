-- Disparo em massa (broadcast/marketing) via WhatsApp — TASK-0171.
-- Pool de números de disparo dedicados por tenant (separado do número
-- operacional do agente de IA em tenant_meta_credentials, que é 1:1 e não
-- deve ser reaproveitado pra disparo em massa), templates de Marketing
-- (metadados só — aprovação continua manual no Meta Business Manager),
-- listas de contatos importadas por CSV, e campanhas que podem dividir
-- uma lista entre vários números ao mesmo tempo.

create table if not exists public.broadcast_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,
  phone_number_id text not null unique,
  waba_id text,
  access_token text,
  status text not null default 'warming' check (status in ('active', 'paused', 'banned', 'warming')),
  warmup_progress_days int not null default 0,
  warmup_last_advanced_on date,
  quality_rating text not null default 'unknown' check (quality_rating in ('unknown', 'high', 'medium', 'low')),
  per_minute_cap int not null default 5,
  daily_cap int not null default 1000,
  min_gap_seconds int not null default 8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists broadcast_numbers_tenant_idx on public.broadcast_numbers (tenant_id);

create table if not exists public.broadcast_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  language text not null,
  category text not null default 'marketing' check (category in ('marketing', 'utility')),
  header_type text not null default 'none' check (header_type in ('none', 'image')),
  body_variable_labels jsonb not null default '[]'::jsonb,
  -- Texto do corpo só pra EXIBIÇÃO no Atendimento (com placeholders
  -- {{label}} substituídos pelas variables do contato na hora do envio) —
  -- a Meta usa o texto real já aprovado no Business Manager, isso aqui
  -- nunca é enviado pra API, só grava algo legível na conversa em vez de
  -- deixar a mensagem exibida em branco/garbled.
  body_text text not null default '',
  -- Imagem de cabeçalho (data URI base64), mesmo padrão de
  -- roadmap_items.image_base64 — guardada aqui pra ser reenviada (upload
  -- fresco via uploadWhatsAppMedia) sempre que uma campanha usando este
  -- template entrar em execução, já que um media_id da Meta não deve ser
  -- reaproveitado indefinidamente entre campanhas separadas no tempo.
  header_image_base64 text,
  footer_text text,
  created_at timestamptz not null default now()
);
create index if not exists broadcast_templates_tenant_idx on public.broadcast_templates (tenant_id);

create table if not exists public.broadcast_contact_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  source_filename text,
  contact_count int not null default 0,
  created_by uuid references public.operators(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists broadcast_contact_lists_tenant_idx on public.broadcast_contact_lists (tenant_id);

create table if not exists public.broadcast_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  list_id uuid not null references public.broadcast_contact_lists(id) on delete cascade,
  phone text not null,
  name text,
  variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (list_id, phone)
);
create index if not exists broadcast_contacts_list_idx on public.broadcast_contacts (list_id);

create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  template_id uuid not null references public.broadcast_templates(id) on delete restrict,
  contact_list_id uuid not null references public.broadcast_contact_lists(id) on delete restrict,
  header_media_id text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'canceled')),
  dedupe_window_days int not null default 3,
  consent_confirmed boolean not null default false,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.operators(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists broadcast_campaigns_tenant_status_idx on public.broadcast_campaigns (tenant_id, status);

create table if not exists public.broadcast_campaign_numbers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  broadcast_number_id uuid not null references public.broadcast_numbers(id) on delete restrict,
  allocation_count int not null check (allocation_count > 0),
  unique (campaign_id, broadcast_number_id)
);

create table if not exists public.broadcast_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.broadcast_contacts(id) on delete cascade,
  broadcast_number_id uuid references public.broadcast_numbers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  phone text not null,
  status text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'delivered', 'failed',
    'skipped_existing_contact', 'skipped_recent_duplicate'
  )),
  wamid text,
  error_message text,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists broadcast_campaign_recipients_dequeue_idx
  on public.broadcast_campaign_recipients (campaign_id, broadcast_number_id, status);
create index if not exists broadcast_campaign_recipients_number_sent_idx
  on public.broadcast_campaign_recipients (broadcast_number_id, status, sent_at);
create index if not exists broadcast_campaign_recipients_tenant_phone_idx
  on public.broadcast_campaign_recipients (tenant_id, phone, status, sent_at desc);

alter table public.broadcast_numbers enable row level security;
alter table public.broadcast_numbers force row level security;
alter table public.broadcast_templates enable row level security;
alter table public.broadcast_templates force row level security;
alter table public.broadcast_contact_lists enable row level security;
alter table public.broadcast_contact_lists force row level security;
alter table public.broadcast_contacts enable row level security;
alter table public.broadcast_contacts force row level security;
alter table public.broadcast_campaigns enable row level security;
alter table public.broadcast_campaigns force row level security;
alter table public.broadcast_campaign_numbers enable row level security;
alter table public.broadcast_campaign_numbers force row level security;
alter table public.broadcast_campaign_recipients enable row level security;
alter table public.broadcast_campaign_recipients force row level security;

drop policy if exists tenant_jwt_isolation on public.broadcast_numbers;
create policy tenant_jwt_isolation on public.broadcast_numbers
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.broadcast_templates;
create policy tenant_jwt_isolation on public.broadcast_templates
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.broadcast_contact_lists;
create policy tenant_jwt_isolation on public.broadcast_contact_lists
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.broadcast_contacts;
create policy tenant_jwt_isolation on public.broadcast_contacts
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.broadcast_campaigns;
create policy tenant_jwt_isolation on public.broadcast_campaigns
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

-- broadcast_campaign_numbers não tem tenant_id próprio (é só um join
-- campanha↔número); isola via subquery na campanha dona da linha.
drop policy if exists tenant_jwt_isolation on public.broadcast_campaign_numbers;
create policy tenant_jwt_isolation on public.broadcast_campaign_numbers
  for all to authenticated
  using (campaign_id in (
    select id from public.broadcast_campaigns
    where tenant_id = (select public.current_runtime_tenant_id())
  ))
  with check (campaign_id in (
    select id from public.broadcast_campaigns
    where tenant_id = (select public.current_runtime_tenant_id())
  ));

drop policy if exists tenant_jwt_isolation on public.broadcast_campaign_recipients;
create policy tenant_jwt_isolation on public.broadcast_campaign_recipients
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

-- Integração com o Atendimento: uma conversa passa a registrar qual número
-- do tenant ela usa (o principal de tenant_meta_credentials, ou um de
-- broadcast_numbers) — sem isso, ao responder um contato de disparo, a
-- resposta sairia pelo número errado do ponto de vista do cliente.
alter table public.conversations
  add column if not exists phone_number_id text;

-- Um envio de campanha não é a IA respondendo nem um operador digitando —
-- precisa do próprio rótulo, senão uma auditoria de "operador respondeu
-- manualmente" (já aconteceu nas TASK-0151/0152) interpretaria errado um
-- envio automático de campanha como digitação humana.
alter table public.messages
  drop constraint if exists messages_sent_by_check;
alter table public.messages
  add constraint messages_sent_by_check check (sent_by in ('ai', 'operator', 'campaign'));

-- A view de listagem (0041) precisa expor phone_number_id também, senão o
-- painel (que lê a lista via essa view, não a tabela conversations direto)
-- nunca saberia por qual número uma conversa está passando. Coluna nova
-- acrescentada ao FINAL do select (depois de unread_count) — o Postgres
-- trata colunas de view por posição: inserir uma coluna no meio faria ele
-- interpretar como um "rename" das colunas seguintes e rejeitar o create
-- or replace view (42P16, erro real encontrado ao aplicar esta migration).
create or replace view public.conversation_list_summaries
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.phone,
  c.name,
  c.geo_restriction,
  c.updated_at,
  c.archived_at,
  c.pinned_at,
  c.muted,
  c.manually_unread,
  c.ad_headline,
  c.ai_blocked_at,
  c.ad_greeting_matched_at,
  c.last_read_at,
  last_message.id as last_message_id,
  last_message.sender as last_message_sender,
  last_message.type as last_message_type,
  last_message.text as last_message_text,
  last_message.created_at as last_message_created_at,
  last_message.reply_to_message_id as last_message_reply_to_message_id,
  last_message.forwarded_from_message_id as last_message_forwarded_from_message_id,
  last_message.reactions as last_message_reactions,
  last_message.sent_by as last_message_sent_by,
  coalesce(unread.unread_count, 0)::integer as unread_count,
  c.phone_number_id
from public.conversations c
left join lateral (
  select
    m.id,
    m.sender,
    m.type,
    m.text,
    m.created_at,
    m.reply_to_message_id,
    m.forwarded_from_message_id,
    m.reactions,
    m.sent_by
  from public.messages m
  where m.tenant_id = c.tenant_id
    and m.conversation_id = c.id
  order by m.created_at desc, m.id desc
  limit 1
) last_message on true
left join lateral (
  select count(*)::integer as unread_count
  from public.messages m
  where m.tenant_id = c.tenant_id
    and m.conversation_id = c.id
    and m.sender = 'lead'
    and m.created_at > c.last_read_at
) unread on true;

grant select on public.conversation_list_summaries to service_role;

comment on table public.broadcast_numbers is 'Pool de números de WhatsApp dedicados a disparo em massa, por tenant — separado do número operacional do agente de IA.';
comment on table public.broadcast_templates is 'Metadados de Templates de Marketing aprovados manualmente no Meta Business Manager.';
comment on table public.broadcast_contact_lists is 'Listas de contatos importadas por CSV para disparo em massa.';
comment on table public.broadcast_campaigns is 'Uma campanha de disparo configurada — pode usar mais de um broadcast_number ao mesmo tempo (ver broadcast_campaign_numbers).';
comment on table public.broadcast_campaign_recipients is 'Fila/log por destinatário — controla a cadência de envio e é o único lugar do sistema que persiste status de entrega por mensagem.';
