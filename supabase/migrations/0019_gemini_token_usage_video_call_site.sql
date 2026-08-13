-- Adiciona 'video' à lista de call_site aceitos em gemini_token_usage
-- (0014_gemini_token_usage.sql) — nova ferramenta do agente (13/08/2026,
-- server/services/autoReply.ts runVideoTool) que envia vídeo de exemplo de
-- produto pro cliente, mesmo padrão de runFotoTool ('foto'). Sem isso, todo
-- INSERT com call_site='video' falha no CHECK constraint (recordGeminiUsage
-- é fire-and-forget e não quebra o envio do vídeo em si, mas a telemetria
-- de uso de tokens fica sem esses registros).
--
-- Idempotente: aplicar de novo é seguro.
alter table public.gemini_token_usage drop constraint if exists gemini_token_usage_call_site_check;
alter table public.gemini_token_usage add constraint gemini_token_usage_call_site_check
  check (call_site in ('router', 'especialista', 'agendamento', 'foto', 'video'));
