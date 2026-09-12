-- TASK-0399 (12/09/2026): pedido direto do dono do produto — "são modelos
-- de negócio diferentes, necessidades diferentes" — dando autonomia real
-- por tenant pra decidir se escalonamento e pagamento pendente também
-- mandam WhatsApp pro admin_alert_phone, além do push que já existia.
--
-- Até aqui esses dois eram só push (TASK-0298, 05/09/2026 — removido do
-- WhatsApp porque um tenant real reclamou de alerta misturado com as
-- conversas dos próprios clientes). Este ajuste só atualiza o DEFAULT da
-- coluna (INSERT de tenant novo) — tenants já existentes já são cobertos
-- pelo merge-on-read em getTenantAlertSettings (tenantProfileStore.ts), que
-- backfilla qualquer chave ausente com DEFAULT_ALERT_PREFERENCES.
--
-- Default `false` pros dois novos, propositalmente diferente dos outros 3
-- (`true`): reativar isso silenciosamente pra todo mundo reproduziria o
-- mesmo incômodo que motivou a remoção original. Só quem entrar na tela de
-- Notificações e ligar explicitamente passa a receber.
alter table public.tenants
  alter column alert_preferences set default '{
    "agent_paused": true,
    "evolution_disconnected": true,
    "system_error": true,
    "escalation": false,
    "payment_pending": false
  }'::jsonb;
