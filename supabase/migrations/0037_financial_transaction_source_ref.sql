-- [Financeiro] Liga o fluxo real de pagamento (verify-payment, quando o
-- operador confirma um comprovante recebido no WhatsApp) a uma
-- financial_transaction criada automaticamente — até aqui os dois sistemas
-- eram desconectados: confirmar um pagamento só atualizava o agendamento,
-- nunca virava um registro financeiro; a única forma de aparecer no
-- Financeiro era o operador digitar tudo de novo manualmente em "Registrar
-- Transferência".
--
-- `source_ref` guarda uma referência estável da origem (ex: o eventId do
-- Google Calendar do agendamento que gerou a venda) — a constraint única
-- (por tenant) garante que uma reentrega/retry do mesmo verify-payment nunca
-- duplica a transação. NULL pra qualquer transação criada manualmente
-- (não tem uma origem rastreável pra deduplicar).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.
alter table public.financial_transactions add column if not exists source_ref text;
create unique index if not exists financial_transactions_tenant_source_ref_idx
  on public.financial_transactions (tenant_id, source_ref)
  where source_ref is not null;
