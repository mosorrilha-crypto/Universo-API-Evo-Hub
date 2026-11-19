-- TASK-0470. Aditiva e compatível com o app anterior. Não retropreenche
-- modelo/raciocínio desconhecidos e não altera policies, grants ou tenant_id.
alter table public.gemini_token_usage
  add column if not exists model text,
  add column if not exists thinking_tokens integer check (thinking_tokens >= 0);

-- Preserva 'video', já aceito no banco de produção.
alter table public.gemini_token_usage drop constraint if exists gemini_token_usage_call_site_check;
alter table public.gemini_token_usage add constraint gemini_token_usage_call_site_check
  check (call_site in ('router', 'especialista', 'agendamento', 'foto', 'video', 'analise', 'transcricao'));
comment on column public.gemini_token_usage.model is 'Modelo enviado ao provedor; null em registros legados sem identificação.';
comment on column public.gemini_token_usage.thinking_tokens is 'Tokens de raciocínio Gemini reportados pela API; null quando ausentes. Groq já os inclui em completion_tokens.';
