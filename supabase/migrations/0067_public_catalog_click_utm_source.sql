-- TASK-0149: sem UTM/referrer capturado, era impossível separar "clique
-- veio de anúncio pago" de "clique orgânico/direto" na página do catálogo —
-- achado real durante a checagem de anúncios de 28/08/2026 (a campanha
-- Catálogo tem custo por conversa muito acima do CTWA nativo, mas sem essa
-- coluna não dava pra saber se o gargalo é a origem do tráfego ou a própria
-- página). `utm_source` chega como veio na querystring da página (ex:
-- "meta_ads" quando o link do anúncio inclui esse parâmetro) — texto livre,
-- sem CHECK constraint, mesmo padrão da coluna `source` já existente.

alter table public.public_catalog_whatsapp_clicks
  add column if not exists utm_source text;

comment on column public.public_catalog_whatsapp_clicks.utm_source is
  'Parâmetro utm_source capturado da URL da página no momento do clique (ex: "meta_ads") — null quando a pessoa chegou sem esse parâmetro (orgânico, direto, ou link do anúncio sem UTM). Permite comparar taxa de conversão por origem de tráfego, diferente de `source` (que indica qual versão/CTA da página gerou o clique).';
