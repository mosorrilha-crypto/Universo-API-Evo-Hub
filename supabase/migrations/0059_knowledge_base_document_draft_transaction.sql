-- TASK-0103 / issue #96 PR2 — persistência atômica de rascunhos.
-- O documento e o respectivo evento precisam fazer parte da mesma transação;
-- a API valida o contrato detalhado do payload antes de chamar este RPC.

create or replace function public.save_knowledge_base_document_draft(
  p_document_type text,
  p_data jsonb,
  p_actor_id uuid
)
returns setof public.knowledge_base_documents
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_document public.knowledge_base_documents%rowtype;
  v_next_version integer;
  v_event_type text;
begin
  v_tenant_id := public.current_runtime_tenant_id();

  if v_tenant_id is null then
    raise exception 'Contexto de tenant ausente para salvar rascunho';
  end if;

  if coalesce(auth.jwt() ->> 'app_role', '') not in ('admin', 'saas_admin') then
    raise exception 'Permissão insuficiente para salvar rascunho'
      using errcode = '42501';
  end if;

  if p_actor_id is null or p_actor_id is distinct from auth.uid() then
    raise exception 'Ator de rascunho inválido'
      using errcode = '42501';
  end if;

  if p_document_type not in (
    'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
    'opening_hours', 'faq', 'human_handoff_rules', 'media_assets'
  ) then
    raise exception 'Tipo de documento inválido: %', p_document_type
      using errcode = '22023';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados de rascunho precisam ser objeto JSON'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':' || p_document_type, 0));

  select *
    into v_document
    from public.knowledge_base_documents
   where tenant_id = v_tenant_id
     and document_type = p_document_type
     and status = 'draft'
   for update;

  if found then
    update public.knowledge_base_documents
       set data = p_data,
           updated_at = now(),
           updated_by = p_actor_id
     where id = v_document.id
     returning * into v_document;
    v_event_type := 'draft_updated';
  else
    select coalesce(max(version), 0) + 1
      into v_next_version
      from public.knowledge_base_documents
     where tenant_id = v_tenant_id
       and document_type = p_document_type;

    insert into public.knowledge_base_documents (
      tenant_id, document_type, version, status, data,
      created_at, created_by, updated_at, updated_by
    ) values (
      v_tenant_id, p_document_type, v_next_version, 'draft', p_data,
      now(), p_actor_id, now(), p_actor_id
    )
    returning * into v_document;
    v_event_type := 'draft_created';
  end if;

  insert into public.knowledge_base_document_events (
    tenant_id, document_id, document_type, version, event_type, actor_id
  ) values (
    v_tenant_id, v_document.id, v_document.document_type, v_document.version, v_event_type, p_actor_id
  );

  return next v_document;
end;
$$;

grant execute on function public.save_knowledge_base_document_draft(text, jsonb, uuid) to authenticated;

comment on function public.save_knowledge_base_document_draft(text, jsonb, uuid) is
  'Cria ou atualiza atomicamente o único rascunho do tenant/type e registra o evento correspondente. Exige JWT admin/saas_admin e ator igual ao sub autenticado.';
