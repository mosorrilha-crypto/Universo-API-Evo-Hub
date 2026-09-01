-- Agendamento de horário de início + janela de horário comercial pro
-- Disparo em Massa (TASK-0173). `broadcast_campaigns.scheduled_at` já
-- existia desde 0068_broadcast_marketing.sql mas nada no código lia esse
-- campo — não havia scheduler nenhum promovendo scheduled->running na hora
-- marcada, e o job de envio mandava a qualquer hora do dia. Esta migration
-- só adiciona as colunas da janela; `scheduled_at` é reaproveitado como já
-- estava.
alter table public.broadcast_campaigns
  add column if not exists send_window_start text,
  add column if not exists send_window_end text,
  add column if not exists send_window_timezone text not null default 'America/Sao_Paulo';
