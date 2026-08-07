-- Agente Vertical — atribuição real de anúncio "Clique para WhatsApp" (CTWA)
-- + credenciais do Meta Conversions API por tenant.
--
-- Achado numa auditoria comparativa contra o projeto standalone antigo da
-- Monique: o webhook do Universo nunca lia `message.referral` (headline,
-- source_id, ctwa_clid) que a Meta manda quando o lead vem de um anúncio —
-- sem isso, o CAPI (Epic 4.5.1) nunca consegue amarrar um evento de
-- conversão ao anúncio real que trouxe o lead.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

-- ── ctwa_clid por conversa — capturado uma vez, na primeira mensagem que
-- veio de um anúncio; nunca sobrescrito depois (é o clique que originou a
-- conversa, não muda com o tempo) ──────────────────────────────────────
alter table public.conversations
  add column if not exists ctwa_clid text,
  add column if not exists ad_source_id text,
  add column if not exists ad_headline text;

-- ── credenciais do Meta Conversions API por tenant — mesmo padrão de
-- tenant_meta_credentials (WhatsApp), mas são dados diferentes: CAPI usa
-- dataset_id + system user token + page_id, não phone_number_id ──────────
alter table public.tenant_meta_credentials
  add column if not exists capi_dataset_id text,
  add column if not exists capi_access_token text,
  add column if not exists capi_page_id text;
