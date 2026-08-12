-- Issue #182 — operador pode cadastrar manualmente um agendamento fechado
-- fora da IA (WhatsApp pessoal, telefone, presencial). `source` distingue
-- esses casos dos agendamentos criados pela própria IA — decisão do dono do
-- produto (12/08/2026): agendamento manual entra no lembrete automático,
-- mas NÃO dispara o evento Purchase pro Meta CAPI (não tem origem de
-- anúncio rastreável, contaria como venda "sem origem" e distorceria a
-- métrica de atribuição de tráfego pago).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.appointments
  add column if not exists source text not null default 'ai' check (source in ('ai', 'manual'));
