-- Agente Vertical, Etapa 1 — pré-reserva registrada + estado de pagamento
-- explícito por agendamento. Ver docs/AGENTE-VERTICAL-ARQUITETURA.md, seções
-- 4.1 e 4.3.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto (Project > SQL Editor > New query) e rode uma vez. Idempotente
-- (usa IF NOT EXISTS / ON CONFLICT em todo lugar), seguro rodar de novo.

-- ── pré-reservas (server/services/preReservationStore.ts) ──────────────
-- wa_message_id é a chave de idempotência: a mesma mensagem de webhook
-- (reentregue por timeout, cenário real da Meta) nunca cria uma segunda
-- pré-reserva/CRMTask pro mesmo evento.
create table if not exists public.pre_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  contact_name text,
  service_name text not null,
  committed_date timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'cancelled')),
  -- contexto da negociação coletado no primeiro contato (objeção, serviço de
  -- interesse etc — seção 6 do script) pra o operador não perder isso quando
  -- for confirmar (seção 4.2 do mapa de arquitetura).
  negotiation_context text,
  wa_message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, wa_message_id)
);
create index if not exists pre_reservations_tenant_status_idx
  on public.pre_reservations (tenant_id, status, committed_date);
create index if not exists pre_reservations_tenant_phone_idx
  on public.pre_reservations (tenant_id, phone);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_pre_reservations_updated_at on public.pre_reservations;
create trigger update_pre_reservations_updated_at
  before update on public.pre_reservations
  for each row
  execute function public.update_updated_at_column();

-- ── estado de pagamento no agendamento ativo (server/services/appointmentStore.ts) ─
-- payment_status nulo = nenhum comprovante enviado ainda (caso comum — nem
-- todo agendamento passa por verificação de transferência). A IA só grava
-- 'pending_verification' quando um comprovante chega; só o operador (ou uma
-- integração bancária real, fora de escopo) grava 'verified'/'rejected'.
alter table public.appointments
  add column if not exists payment_status text check (payment_status in ('pending_verification', 'verified', 'confirmed', 'rejected')),
  add column if not exists payment_proof_message_id text,
  add column if not exists payment_verified_by uuid references public.operators(id),
  add column if not exists payment_verified_at timestamptz;

-- ── Row Level Security (mesmo padrão do Bloco 2.A — ver nota na migration 0001
-- sobre a service key ainda bypassar RLS; políticas ficam prontas e corretas
-- mesmo assim) ────────────────────────────────────────────────────────────
alter table public.pre_reservations enable row level security;
alter table public.pre_reservations force row level security;
drop policy if exists tenant_isolation on public.pre_reservations;
create policy tenant_isolation on public.pre_reservations
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
