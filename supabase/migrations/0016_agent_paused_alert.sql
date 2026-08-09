-- Issue #115 — agente pausado não gerava nenhum alerta pro operador; leads
-- ficavam sem resposta em silêncio (achado real em produção em 09/08/2026:
-- agent_status ficou 'paused' por ~4h, 8 mensagens de 6 leads diferentes sem
-- nenhuma resposta e sem nenhum escalonamento, porque pausa é estado
-- intencional, não erro, então o caminho de escalonamento nunca disparava).
--
-- admin_alert_phone: número de WhatsApp do operador/dono que recebe o
-- alerta quando o agente fica pausado tempo demais com lead sem resposta
-- (server/services/agentPausedAlertJob.ts). Nullable — tenant sem número
-- configurado simplesmente não recebe alerta (job loga e segue, não falha).
--
-- paused_alert_sent_at: idempotência por "sessão de pausa" — como
-- setAgentStatus sempre atualiza updated_at (mesmo reafirmando o mesmo
-- status), comparar paused_alert_sent_at com updated_at detecta se já
-- alertou pra ESSA pausa específica, sem duplicar a cada tick do job nem
-- deixar de alertar de novo se pausar → reativar → pausar de novo.

alter table public.tenants
  add column if not exists admin_alert_phone text;

alter table public.agent_status
  add column if not exists paused_alert_sent_at timestamptz;
