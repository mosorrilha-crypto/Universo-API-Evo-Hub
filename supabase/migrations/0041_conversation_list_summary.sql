-- Reduz o egress do painel: a lista de conversas precisa apenas de metadados
-- e da última mensagem; o histórico completo é carregado ao abrir o atendimento.
-- A view continua tenant-scoped e usa security_invoker para respeitar as RLS
-- das tabelas base quando consultada fora do backend service-role.

create or replace view public.conversation_list_summaries
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.phone,
  c.name,
  c.geo_restriction,
  c.updated_at,
  c.archived_at,
  c.pinned_at,
  c.muted,
  c.manually_unread,
  c.ad_headline,
  c.ai_blocked_at,
  c.ad_greeting_matched_at,
  c.last_read_at,
  last_message.id as last_message_id,
  last_message.sender as last_message_sender,
  last_message.type as last_message_type,
  last_message.text as last_message_text,
  last_message.created_at as last_message_created_at,
  last_message.reply_to_message_id as last_message_reply_to_message_id,
  last_message.forwarded_from_message_id as last_message_forwarded_from_message_id,
  last_message.reactions as last_message_reactions,
  last_message.sent_by as last_message_sent_by,
  coalesce(unread.unread_count, 0)::integer as unread_count
from public.conversations c
left join lateral (
  select
    m.id,
    m.sender,
    m.type,
    m.text,
    m.created_at,
    m.reply_to_message_id,
    m.forwarded_from_message_id,
    m.reactions,
    m.sent_by
  from public.messages m
  where m.tenant_id = c.tenant_id
    and m.conversation_id = c.id
  order by m.created_at desc, m.id desc
  limit 1
) last_message on true
left join lateral (
  select count(*)::integer as unread_count
  from public.messages m
  where m.tenant_id = c.tenant_id
    and m.conversation_id = c.id
    and m.sender = 'lead'
    and m.created_at > c.last_read_at
) unread on true;

grant select on public.conversation_list_summaries to service_role;
