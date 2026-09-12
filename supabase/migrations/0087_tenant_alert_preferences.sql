-- TASK a definir (pedido direto, 12/09/2026): até aqui `admin_alert_phone`
-- só dava pra configurar via SQL direto no Supabase, e os 3 jobs que mandam
-- WhatsApp pra esse número (agentPausedAlertJob.ts/
-- evolutionConnectionAlertJob.ts/systemErrorAlertService.ts) disparavam
-- incondicionalmente sempre que o número existisse, sem nenhum jeito do
-- tenant escolher quais tipos de alerta quer receber ali. Achado real que
-- motivou o pedido: alertas de um tenant (Dr. Daniel Oliveira) chegando no
-- número de outro (Monique), porque o `admin_alert_phone` tinha sido
-- configurado errado/repetido manualmente.
--
-- Coluna nova, jsonb, uma chave booleana por tipo de alerta que hoje usa
-- WhatsApp de verdade (ver server/services/tenantAlertSettingsStore.ts pra
-- a lista completa e por que só esses 3 — escalonamento e pagamento
-- pendente já são só notificação push desde a TASK-0298, sem número
-- nenhum envolvido). Default `true` pros 3 tipos — preserva o
-- comportamento atual (todo tenant com admin_alert_phone configurado já
-- recebe os 3 hoje) pra quem nunca abrir a tela nova.
alter table public.tenants
  add column if not exists alert_preferences jsonb not null default '{"agent_paused": true, "evolution_disconnected": true, "system_error": true}'::jsonb;
