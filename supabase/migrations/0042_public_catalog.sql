-- Catálogo público por tenant — fonte de verdade comercial no Universo.
--
-- O catálogo é opt-in: tenants existentes permanecem privados até que um
-- operador habilite public_catalog_enabled. Contatos públicos são separados
-- de tenant_meta_credentials para nunca expor tokens, WABA ou phone_number_id.
-- Aplicar via Supabase MCP `apply_migration` e confirmar em `list_migrations`.

alter table public.tenants
  add column if not exists public_catalog_enabled boolean not null default false,
  add column if not exists public_whatsapp_phone text,
  add column if not exists public_instagram_url text,
  add column if not exists public_location_maps_url text,
  add column if not exists public_address text,
  add column if not exists public_hours_label text;

-- Configuração pública já conhecida do catálogo antigo da Monique. `coalesce`
-- preserva qualquer ajuste que já tenha sido feito manualmente.
update public.tenants
set public_catalog_enabled = true,
    public_whatsapp_phone = coalesce(public_whatsapp_phone, '595981436141'),
    public_instagram_url = coalesce(public_instagram_url, 'https://instagram.com/pestanaspormonique'),
    public_location_maps_url = coalesce(public_location_maps_url, 'https://www.google.com/maps?q=-25.2516845,-57.4997556&z=17&hl=pt-BR'),
    public_address = coalesce(public_address, 'Paso Bogarín 3665, Loma Merlo, Luque'),
    public_hours_label = coalesce(public_hours_label, 'Lun–Vie 7:30–20h · Sáb 8–13h · Dom 9–17h')
where id = '11111111-1111-1111-1111-111111111111';
