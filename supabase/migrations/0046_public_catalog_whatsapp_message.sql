-- Mensagem pré-preenchida do botão de WhatsApp no catálogo público (Epic
-- "catálogo antes do WhatsApp") — antes só dava pra editar via deploy de
-- código (texto fixo em PublicCatalogPage.tsx). NULL mantém o texto padrão
-- atual (retrocompatível com tenants que já ativaram o catálogo).
-- Aplicar via Supabase MCP `apply_migration` e confirmar em `list_migrations`.

alter table public.tenants
  add column if not exists public_whatsapp_message_general text,
  add column if not exists public_whatsapp_message_product text;
