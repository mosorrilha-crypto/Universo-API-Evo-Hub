-- Central de Tráfego Meta Ads — credenciais de leitura por tenant.
--
-- A conta de anúncios e o token de Marketing API permanecem somente no banco e
-- no backend. O frontend recebe apenas `configured` e métricas já calculadas.
-- O token pode ser o mesmo system-user token da CAPI quando ele também tiver a
-- permissão ads_read; manter uma coluna própria permite separar os privilégios
-- quando a operação quiser usar um token exclusivo de leitura.

alter table public.tenant_meta_credentials
  add column if not exists meta_ads_account_id text,
  add column if not exists meta_ads_access_token text;

comment on column public.tenant_meta_credentials.meta_ads_account_id is
  'Conta Meta Ads no formato act_<id>, usada exclusivamente pela Central de Tráfego.';

comment on column public.tenant_meta_credentials.meta_ads_access_token is
  'Token server-side da Marketing API com ads_read. Nunca retornar ao frontend.';
