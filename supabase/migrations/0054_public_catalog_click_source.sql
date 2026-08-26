-- Segundo catálogo da Monique (/catalogo/monique-teste/novo, TASK-0087) usa o
-- mesmo endpoint de clique de WhatsApp do catálogo original
-- (/api/public/catalog/:slug/whatsapp-click) — sem esta coluna, os cliques das
-- duas páginas ficavam somados no mesmo contador, sem jeito de comparar qual
-- catálogo converte mais (pedido real do dono do produto, 26/08/2026).
--
-- `source` é opcional e livre (validado/limitado no backend antes de gravar):
-- null = cliques antigos, de antes desta coluna existir, e clique sem origem
-- informada. 'legacy' = catálogo original. 'novo' = segundo catálogo
-- (Beauty Concierge preto e dourado).

alter table public.public_catalog_whatsapp_clicks
  add column if not exists source text;

comment on column public.public_catalog_whatsapp_clicks.source is
  'Qual página de catálogo gerou o clique — "legacy" (catálogo original) ou "novo" (segundo catálogo, TASK-0087). null = anterior a esta coluna ou origem não informada.';
