-- TASK-0399 (12/09/2026): pedido direto do dono do produto — painel de
-- comando das mensagens automáticas mandadas pro CLIENTE FINAL (não pro
-- dono do tenant, que é `alert_preferences` na migration 0087/0088). "O que
-- enviar, quando enviar e se quer enviar" pra 3 comportamentos hoje
-- hardcoded e fixos pra todo tenant:
--   - appointmentReminders: lembrete de agendamento (reminderJob.ts)
--   - abandonedConversationReactivation: retomada de conversa parada fora
--     da janela de 24h do WhatsApp (operatorFollowUpService.ts)
--   - funnelAutoFollowUp: reengajamento automático quando o cliente some
--     depois que a IA ofereceu um horário (pendingFollowUpJob.ts/webhooks.ts)
--
-- Coluna separada de `alert_preferences` de propósito: aqui os parâmetros
-- são objetos aninhados com números/horário, não só booleano — misturar os
-- dois formatos no mesmo campo complicaria os dois.
--
-- O default abaixo reproduz EXATAMENTE as constantes hardcoded de hoje
-- (72h de antecedência, cortes às 08:30/07:30, retomada sempre ligada,
-- 2.5h de espera e janela 7h-19h do funil) — nenhum tenant existente muda
-- de comportamento até entrar na tela nova e mexer em algo. Tenants
-- existentes são cobertos pelo merge-on-read em
-- getTenantCustomerNotificationPreferences (tenantProfileStore.ts).
alter table public.tenants
  add column if not exists customer_notification_preferences jsonb not null default '{
    "appointmentReminders": {
      "enabled": true,
      "diaAnteriorEnabled": true,
      "diaAnteriorMinLeadHours": 72,
      "diaAnteriorEarliestTime": "08:30",
      "mesmoDiaEnabled": true,
      "mesmoDiaEarliestTime": "07:30"
    },
    "abandonedConversationReactivation": { "enabled": true },
    "funnelAutoFollowUp": { "enabled": true, "delayHours": 2.5, "businessHoursStart": 7, "businessHoursEnd": 19 }
  }'::jsonb;
