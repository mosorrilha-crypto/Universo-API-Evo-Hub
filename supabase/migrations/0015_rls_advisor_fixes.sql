-- [Supabase] Corrige os achados do Advisor (performance+segurança) —
-- GitHub issue #91 (da auditoria estrutural #82, item 6). Reconfirmado ao
-- vivo contra o projeto pkocepjfedtsxmufymvd antes de escrever esta
-- migration (get_advisors performance+security).
--
-- 1) 14 tabelas com policy RLS reavaliando current_setting() POR LINHA em
--    vez de uma vez só (auth_rls_initplan) — troca current_setting(...) por
--    (select current_setting(...)) em cada policy, sem mudar a regra de
--    isolamento nenhuma (mesmo predicado, só a forma de avaliação). ALTER
--    POLICY em vez de drop+create: preserva a policy, troca só USING/WITH
--    CHECK.
-- 2) 3 foreign keys sem índice de cobertura (unindexed_foreign_keys) —
--    messages.conversation_id é a sensível, toda leitura de histórico de
--    conversa passa por ali.
-- 3) search_path mutável em public.update_updated_at_column
--    (function_search_path_mutable) — hardening padrão, função só usa
--    NEW.updated_at, não referencia nenhum objeto de outro schema.
--
-- NÃO alterado: índice pre_reservations_tenant_phone_idx segue sem uso
-- ativo no Advisor, mas não é dropado aqui — volume ainda muito baixo pra
-- essa métrica ser conclusiva (e escalations_tenant_idx, listado como não
-- usado na auditoria original de 07/08, já aparece em uso agora que a UI de
-- escalonamentos existe — mesmo risco se aplicaria aqui: dropar cedo demais
-- por otimização prematura).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo (ALTER POLICY
-- substitui a definição; CREATE INDEX IF NOT EXISTS; ALTER FUNCTION é
-- idempotente por natureza).

-- ── 1) RLS: current_setting() avaliado uma vez por query, não por linha ──

alter policy tenant_self on public.tenants
  using (id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.operators
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.tenant_meta_credentials
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.conversation_labels
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.pre_reservations
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.tenant_calendar_tokens
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.conversations
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.messages
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.knowledge_base
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.escalations
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.quick_replies
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.agent_status
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.appointments
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

alter policy tenant_isolation on public.sent_reminders
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

-- ── 2) Índices de cobertura pras foreign keys sinalizadas ──

create index if not exists appointments_payment_verified_by_idx
  on public.appointments (payment_verified_by);

create index if not exists conversation_labels_conversation_id_idx
  on public.conversation_labels (conversation_id);

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id);

-- ── 3) search_path fixo na função de trigger ──

alter function public.update_updated_at_column() set search_path = '';
