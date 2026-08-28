/**
 * Formato exigido pro `slug` de um tenant: minúsculas, dígitos e hífen, sem
 * espaço/acento/maiúscula. Mesma forma que a rota pública já exige na URL
 * (`^\/catalogo\/([a-z0-9][a-z0-9-]{0,79})\/?$`, `src/main.tsx`) — um slug
 * fora desse formato nunca bate com nenhuma URL real, então salvá-lo assim
 * derruba o catálogo público em silêncio, sem erro nenhum na hora de salvar.
 *
 * Achado real em produção (27/08/2026): o slug do tenant real da Monique foi
 * trocado pelo painel de "monique-teste" pra "Pestañas por Monique" (espaço +
 * acento) ao editar só o nome — a rota aceitava de bom grado, sem validar
 * nada, e os dois catálogos públicos (além dos 5 anúncios ativos apontando
 * pra lá) saíram do ar até alguém notar e reverter via SQL direto no banco.
 * Compartilhado entre `routes/admin.ts` (edição por saas_admin) e
 * `routes/conversations.ts` (definição pelo próprio admin do tenant, na
 * primeira ativação do catálogo) pra nunca divergir.
 */
export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const TENANT_SLUG_FORMAT_ERROR = 'Slug inválido: use só letras minúsculas, números e hífen (ex: "minha-empresa"), sem espaço, acento ou maiúscula — esse valor vira parte da URL pública do catálogo.';

/** Código do Postgres pra violação de constraint UNIQUE (`tenants_slug_key`). */
export const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
export const TENANT_SLUG_TAKEN_ERROR = 'Esse endereço já está em uso por outro tenant — escolha outro.';

/** Traduz o erro cru de violação de UNIQUE (slug duplicado) numa mensagem amigável; qualquer outro erro passa direto. */
export function friendlyTenantSlugError(error: { code?: string; message: string }): string {
  return error.code === POSTGRES_UNIQUE_VIOLATION_CODE ? TENANT_SLUG_TAKEN_ERROR : error.message;
}
