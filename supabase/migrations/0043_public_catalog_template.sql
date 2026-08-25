-- Catálogo público: template visual isolado por tenant.
-- O default mantém o comportamento atual para todas as empresas.
alter table public.tenants
  add column if not exists public_catalog_template text not null default 'default';

alter table public.tenants
  drop constraint if exists tenants_public_catalog_template_check;

alter table public.tenants
  add constraint tenants_public_catalog_template_check
  check (public_catalog_template in ('default', 'beauty_concierge', 'gold_catalog'));

comment on column public.tenants.public_catalog_template is
  'Template visual do catálogo público deste tenant. gold_catalog é opt-in e não é aplicado automaticamente a outros tenants.';
