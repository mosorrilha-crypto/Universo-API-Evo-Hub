-- Índices em FKs sinalizadas pelo advisor de performance do Supabase
-- depois de aplicar 0068_broadcast_marketing.sql — nível INFO, não
-- bloqueante, mas baratos de resolver.
create index if not exists broadcast_campaign_numbers_number_idx on public.broadcast_campaign_numbers (broadcast_number_id);
create index if not exists broadcast_campaign_recipients_contact_idx on public.broadcast_campaign_recipients (contact_id);
create index if not exists broadcast_campaign_recipients_conversation_idx on public.broadcast_campaign_recipients (conversation_id);
create index if not exists broadcast_campaigns_contact_list_idx on public.broadcast_campaigns (contact_list_id);
create index if not exists broadcast_campaigns_template_idx on public.broadcast_campaigns (template_id);
create index if not exists broadcast_campaigns_created_by_idx on public.broadcast_campaigns (created_by);
create index if not exists broadcast_contact_lists_created_by_idx on public.broadcast_contact_lists (created_by);
create index if not exists broadcast_contacts_tenant_idx on public.broadcast_contacts (tenant_id);
