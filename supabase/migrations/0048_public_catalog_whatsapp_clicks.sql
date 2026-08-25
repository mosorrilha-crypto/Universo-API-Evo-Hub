-- Contador interno de clique nos botões de WhatsApp do catálogo público —
-- pedido direto do dono do produto (25/08/2026): saber "quantas pessoas
-- clicaram no link do WhatsApp do catálogo" sem depender do Meta Pixel (o
-- evento do pixel só chega pro Facebook, nunca pro nosso backend) nem do
-- reconhecimento por texto de "Gatilhos de Anúncio" (frágil — só funciona se
-- o cliente mandar a mensagem pré-preenchida exatamente como veio).
--
-- Cada clique é registrado ANTES do redirect pro WhatsApp (contagem real,
-- não depende da mensagem chegar), e ganha um "code" único (sequência curta
-- de emojis, ver publicCatalogClickStore.ts) embutido na mensagem
-- pré-preenchida — se a mensagem realmente chegar no WhatsApp com esse code,
-- o agente liga a conversa a este clique específico com certeza (matched_at/
-- matched_phone), sem depender de match de prefixo de texto.
--
-- Aplicar via Supabase MCP `apply_migration` e confirmar em `list_migrations`.

create table if not exists public.public_catalog_whatsapp_clicks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  product text,
  message text not null,
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  matched_phone text
);

create index if not exists public_catalog_whatsapp_clicks_tenant_created_idx
  on public.public_catalog_whatsapp_clicks (tenant_id, created_at desc);

alter table public.public_catalog_whatsapp_clicks enable row level security;

-- Sem policy de leitura/escrita por usuário final — só o backend acessa
-- (service role, mesmo padrão de outras tabelas internas deste projeto).

comment on table public.public_catalog_whatsapp_clicks is
  'Contador interno de clique nos botões de WhatsApp do catálogo público, independente de Meta Pixel/Windsor.ai. code = sequência de emojis embutida na mensagem pré-preenchida pra ligar uma mensagem recebida a este clique específico.';
