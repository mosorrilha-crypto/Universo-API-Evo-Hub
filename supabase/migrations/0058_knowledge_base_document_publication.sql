-- TASK-0103 / issue #96 PR2 — publicação auditável de documentos tipados.
--
-- A PR1 mantém uma única versão `published` por tenant/tipo. Para preservar
-- histórico, esta etapa acrescenta `archived` e centraliza a publicação em
-- uma função transacional. O runtime do agente continua no blob legado.

alter table public.knowledge_base_documents
  drop constraint if exists knowledge_base_documents_status_check;

alter table public.knowledge_base_documents
  add constraint knowledge_base_documents_status_check
  check (status in ('draft', 'published', 'archived'));

create or replace function public.publish_knowledge_base_document(
  p_document_type text,
  p_actor_id uuid
)
returns setof public.knowledge_base_documents
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_draft public.knowledge_base_documents%rowtype;
begin
  v_tenant_id := public.current_runtime_tenant_id();

  if v_tenant_id is null then
    raise exception 'Contexto de tenant ausente para publicar documento';
  end if;

  -- Defesa no banco: a rota já exige admin, mas uma chamada direta ao RPC
  -- autenticado não pode publicar quando o JWT não representar admin.
  if coalesce(auth.jwt() ->> 'app_role', '') not in ('admin', 'saas_admin') then
    raise exception 'Permissão insuficiente para publicar documento'
      using errcode = '42501';
  end if;

  -- `sub` é emitido pelo backend a partir do operador autenticado. Exigir
  -- igualdade impede que o chamador atribua a publicação a outro operador.
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then
    raise exception 'Ator de publicação inválido'
      using errcode = '42501';
  end if;

  if p_document_type not in (
    'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
    'opening_hours', 'faq', 'human_handoff_rules', 'media_assets'
  ) then
    raise exception 'Tipo de documento inválido: %', p_document_type
      using errcode = '22023';
  end if;

  -- Serializa a mesma combinação tenant/tipo dentro da transação, inclusive
  -- se duas abas tentarem publicar ao mesmo tempo. O índice parcial continua
  -- sendo a segunda barreira de integridade.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':' || p_document_type, 0));

  select *
    into v_draft
    from public.knowledge_base_documents
   where tenant_id = v_tenant_id
     and document_type = p_document_type
     and status = 'draft'
   for update;

  if not found then
    raise exception 'Não existe rascunho para publicar'
      using errcode = 'P0002';
  end if;

  update public.knowledge_base_documents
     set status = 'archived',
         updated_at = now(),
         updated_by = p_actor_id
   where tenant_id = v_tenant_id
     and document_type = p_document_type
     and status = 'published';

  update public.knowledge_base_documents
     set status = 'published',
         updated_at = now(),
         updated_by = p_actor_id,
         published_at = now(),
         published_by = p_actor_id
   where id = v_draft.id
   returning * into v_draft;

  insert into public.knowledge_base_document_events (
    tenant_id, document_id, document_type, version, event_type, actor_id
  ) values (
    v_tenant_id, v_draft.id, v_draft.document_type, v_draft.version, 'published', p_actor_id
  );

  return next v_draft;
end;
$$;

grant execute on function public.publish_knowledge_base_document(text, uuid) to authenticated;

comment on function public.publish_knowledge_base_document(text, uuid) is
  'Publica atomicamente o rascunho do tenant/type atual, arquiva a publicação anterior e registra auditoria. Exige JWT admin/saas_admin e ator igual ao sub autenticado.';
