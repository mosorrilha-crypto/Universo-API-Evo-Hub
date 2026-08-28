-- Incidente real em produção (27/08/2026): o slug de um tenant com catálogo
-- público podia ser trocado desligando o catálogo, editando o slug, e
-- religando de novo — a trava anterior (PATCH /api/admin/tenants/:id só
-- bloqueia enquanto public_catalog_enabled: true) não cobria esse caminho.
-- Isso quebra silenciosamente qualquer link já compartilhado (anúncios
-- ativos, favoritos de clientes) mesmo usando um slug em formato válido,
-- porque o valor específico é o que está gravado nesses links — não dá pra
-- "desfazer" o compartilhamento.
--
-- Esta coluna marca, de forma permanente, que o catálogo de um tenant já foi
-- ativado ao menos uma vez — diferente de public_catalog_enabled (que reflete
-- só o estado atual do toggle e pode voltar a false). Uma vez true, nunca
-- volta a false: é o sinal que o backend usa pra travar o slug pra sempre,
-- mesmo com o catálogo desligado depois.

alter table public.tenants
  add column if not exists public_catalog_slug_locked boolean not null default false;

comment on column public.tenants.public_catalog_slug_locked is
  'true assim que o catálogo público deste tenant foi ativado pela primeira vez — nunca volta a false. Usado pra travar o slug permanentemente (links já compartilhados dependem do valor exato), mesmo que o catálogo seja desligado depois.';

-- Tenants que já têm o catálogo ativo hoje contam como "já foi ativado
-- alguma vez" — sem isso, o primeiro PATCH de slug num tenant já publicado
-- passaria batido só porque a trava nova nasceu com o valor default (false).
update public.tenants
  set public_catalog_slug_locked = true
  where public_catalog_enabled = true;
