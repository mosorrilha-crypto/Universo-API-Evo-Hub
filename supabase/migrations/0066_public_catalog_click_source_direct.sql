-- TASK-0125: novo CTA "Hablar directamente por WhatsApp" na primeira dobra
-- do segundo catálogo (Beauty Concierge, /catalogo/monique-teste/novo) pula
-- a triagem inteira — precisa de origem própria ('direct') pra não ficar
-- misturado com quem completou a evaluación (já contado como 'novo').
--
-- `source` já era `text` livre desde a migration 0054 (sem CHECK constraint),
-- então nenhuma alteração estrutural é necessária — só atualiza o comentário
-- da coluna pra documentar o novo valor aceito.

comment on column public.public_catalog_whatsapp_clicks.source is
  'Qual CTA gerou o clique — "legacy" (catálogo original), "novo" (segundo catálogo, triagem completa) ou "direct" (segundo catálogo, botão direto na primeira dobra, TASK-0125). null = anterior à coluna existir ou origem não informada.';
