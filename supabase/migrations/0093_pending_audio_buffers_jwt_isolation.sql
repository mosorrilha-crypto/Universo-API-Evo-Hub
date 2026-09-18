-- TASK-0434 — achado real em produção (log Render, tenant Monique, cliente
-- "Esmilce Cardozo"): "⚠️  [Buffer de áudio] Falha ao persistir marca pra
-- 595984660374: new row violates row-level security policy for table
-- 'pending_audio_buffers'".
--
-- A tabela `pending_audio_buffers` (migration 0092, TASK-0430) nasceu com a
-- policy do padrão ANTIGO (`current_setting('app.current_tenant_id', true)`),
-- copiada do texto histórico da migration 0033 de `pending_message_buffers`.
-- Só que o mecanismo real de isolamento multi-tenant do backend foi trocado
-- pra JWT (`current_runtime_tenant_id()`, lido via `auth.jwt()`) na migration
-- 0049 — que já reescreveu a policy de TODAS as tabelas com `tenant_id`
-- existentes naquele momento pro padrão `tenant_jwt_isolation`, `pending_
-- message_buffers` incluída (a policy dela hoje em produção não é mais a do
-- arquivo 0033 — 0049 substituiu). `pending_audio_buffers` só passou a
-- existir depois (TASK-0430), então nunca recebeu essa correção — a
-- variável `app.current_tenant_id` que sua policy espera nunca é definida
-- por nada no app (`createTenantScopedSupabaseClient` assina um JWT com o
-- claim `tenant_id`, nunca um GUC de sessão), então 100% das gravações
-- (`persistBuffer`/`deletePersistedBuffer`, audioMessageBuffer.ts) falhavam
-- silenciosamente (só um console.warn) desde que a TASK-0430 foi ao ar.
--
-- Impacto real: a persistência que a TASK-0430 criou especificamente pra
-- sobreviver a um restart do servidor no meio da janela de silêncio do
-- buffer de áudio nunca funcionou de verdade — um restart nesse intervalo
-- perderia o áudio do cliente silenciosamente (o buffer só existia em
-- memória), exatamente o cenário que a tabela foi criada pra evitar.
--
-- Corrige igualando ao padrão já usado em toda a base (mesmo texto que a
-- migration 0049 gera dinamicamente pra cada tabela com tenant_id).

drop policy if exists tenant_isolation on public.pending_audio_buffers;
drop policy if exists tenant_jwt_isolation on public.pending_audio_buffers;
create policy tenant_jwt_isolation on public.pending_audio_buffers
  for all
  to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));
