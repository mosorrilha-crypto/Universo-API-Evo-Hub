-- TASK-0091 — contatos recebidos pela página pública de oferta.
-- Não pertence a tenant: são potenciais clientes ainda sem empresa provisionada.

create table if not exists public.commercial_interest_requests (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null check (plan_key in ('essencial', 'profissional')),
  name text not null check (char_length(trim(name)) between 2 and 120),
  business_name text not null check (char_length(trim(business_name)) between 2 and 160),
  whatsapp text not null check (char_length(trim(whatsapp)) between 8 and 32),
  email text check (email is null or char_length(trim(email)) <= 160),
  note text check (note is null or char_length(trim(note)) <= 600),
  consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed_lost', 'converted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_interest_requests_status_created_idx
  on public.commercial_interest_requests (status, created_at desc);

-- Nenhum visitante acessa a tabela diretamente. O POST público é validado e
-- rate-limited no servidor, que grava via cliente de plataforma.
revoke all privileges on table public.commercial_interest_requests from anon, authenticated;
alter table public.commercial_interest_requests enable row level security;
alter table public.commercial_interest_requests force row level security;
drop policy if exists platform_only_deny_api on public.commercial_interest_requests;
create policy platform_only_deny_api
on public.commercial_interest_requests
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
