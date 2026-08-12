-- Issue #98 — job de alerta de pagamento pendente de verificação há mais de
-- 2h. O bloqueio original (falta de "WhatsApp do admin por tenant") já foi
-- resolvido pela migration 0016 (tenants.admin_alert_phone); esta migration
-- só adiciona o rastreio de "desde quando" e "já alertou" no próprio
-- agendamento, mesmo padrão de pre_reservations.followup_alerted_at
-- (migration 0010).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.appointments
  add column if not exists payment_pending_since timestamptz,
  add column if not exists payment_pending_alerted_at timestamptz;
