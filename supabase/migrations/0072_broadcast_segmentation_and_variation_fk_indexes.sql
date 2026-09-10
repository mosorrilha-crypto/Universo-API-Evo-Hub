-- Índices em FKs sinalizadas pelo advisor de performance do Supabase
-- depois de aplicar 0071_broadcast_segmentation_and_variation.sql — nível
-- INFO, não bloqueante, mas baratos de resolver.
create index if not exists broadcast_campaign_recipients_template_idx on public.broadcast_campaign_recipients (template_id);
create index if not exists broadcast_campaign_templates_template_idx on public.broadcast_campaign_templates (template_id);
