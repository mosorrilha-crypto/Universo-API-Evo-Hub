-- Issue #289 — o evento real no Google Calendar não pode mais ser criado
-- de forma otimista, antes do comprovante de pagamento ser aprovado por um
-- operador (decisão do dono do produto, 18/08/2026: aceitar o risco de um
-- horário reservado por um cliente ser disputado por outro enquanto o
-- primeiro não paga, com expiração de 2h pra reduzir esse risco — ver
-- server/services/appointmentStore.ts e server/services/autoReply.ts).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto (Project > SQL Editor > New query) e rode uma vez. Idempotente,
-- seguro rodar de novo.

-- event_id passa a poder ser nulo: uma linha em `appointments` agora pode
-- representar só uma RESERVA (sem evento real ainda) enquanto aguarda
-- aprovação do comprovante.
alter table public.appointments alter column event_id drop not null;

-- Até quando uma reserva sem evento real (payment_status = 'awaiting_payment')
-- continua válida antes de expirar e liberar o horário — ver
-- heldAppointmentExpiryJob.ts.
alter table public.appointments add column if not exists held_until timestamptz;

-- 'awaiting_payment' = reserva feita pela IA, aguardando o cliente mandar o
-- comprovante (nunca chegou nenhum ainda) — estado novo, adicionado ANTES de
-- 'pending_verification' na ordem lógica do fluxo real.
alter table public.appointments drop constraint if exists appointments_payment_status_check;
alter table public.appointments add constraint appointments_payment_status_check
  check (payment_status in ('awaiting_payment', 'pending_verification', 'verified', 'confirmed', 'rejected'));

create index if not exists appointments_held_until_idx
  on public.appointments (tenant_id, payment_status, held_until)
  where payment_status = 'awaiting_payment';
