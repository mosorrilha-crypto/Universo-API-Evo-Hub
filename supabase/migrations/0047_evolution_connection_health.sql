-- Investigação real (24/08/2026, tenant Monique — Lucas Gimenes): a sessão
-- Baileys/Evolution de um tenant pode cair sem que ninguém perceba (o
-- WhatsApp continua entregando mensagem ponta-a-ponta entre os dois números
-- normalmente, mas o webhook pra nosso backend para de chegar — nem a
-- mensagem do lead, nem o eco do que o operador manda direto do celular).
-- Só dava pra descobrir abrindo Configurações e reparando no botão
-- "Reconectar WhatsApp". Estas colunas sustentam
-- server/services/evolutionConnectionAlertJob.ts, que detecta a queda e
-- alerta o operador (nunca reconecta sozinho).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.tenant_evolution_credentials
  add column if not exists last_connection_state text,
  add column if not exists disconnected_since timestamptz,
  add column if not exists disconnected_alert_sent_at timestamptz;
