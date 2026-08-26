import { getDb } from './db';
import { buildCatalogThumbnail } from './catalogImageThumbnail';
import {
  getKnowledgeBase,
  resolveProductPrice,
  resolveProductPriceAmount,
  resolveVariantPrice,
  resolveVariantPriceAmount,
  type AgentProduct,
  type ProductVariant,
  type BeforeAfterPair,
} from './knowledgeBaseStore';

export interface PublicBeforeAfterPair {
  id: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  caption?: string;
}

export interface PublicCatalogVariant {
  code: string;
  description?: string;
  /** Miniatura pública e comprimida da foto exclusiva da variação. */
  imageUrl?: string;
  /** Template de WhatsApp específico do efeito/modelo; não expõe dados internos do agente. */
  whatsappMessage?: string;
  beforeAfter?: PublicBeforeAfterPair[];
  dimensions?: string;
  litros?: number;
  price: string;
  priceAmount?: number;
  durationMinutes?: number;
}

export interface PublicCatalogProduct {
  name: string;
  category?: string;
  description?: string;
  price: string;
  priceAmount?: number;
  currency: string;
  durationMinutes?: number;
  variants?: PublicCatalogVariant[];
  /** Miniatura comprimida (data URI JPEG) — nunca a foto original (`exampleImageBase64`), que pode chegar a alguns MB e é privada/interna. */
  imageUrl?: string;
  beforeAfter?: PublicBeforeAfterPair[];
}

export interface PublicCatalog {
  tenant: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
    template?: 'default' | 'beauty_concierge' | 'gold_catalog';
  };
  contact: {
    whatsappNumber?: string;
    instagramUrl?: string;
    locationMapsUrl?: string;
    addressLabel?: string;
    hoursLabel?: string;
    /** Texto pré-preenchido do botão geral de WhatsApp ("Escribinos por WhatsApp"). Ausente = frontend usa o texto padrão. */
    whatsappMessageGeneral?: string;
    /** Template do texto pré-preenchido do botão "Consultar por WhatsApp" de cada produto — `{produto}` é trocado pelo nome do produto. Ausente = frontend usa o texto padrão. */
    whatsappMessageProduct?: string;
  };
  products: PublicCatalogProduct[];
  /**
   * Pixel do Meta pro frontend rastrear visita/clique de WhatsApp nesta
   * página — mesmo `capi_dataset_id` já usado pelo CAPI server-side
   * (metaCapiService.ts) pro evento "Schedule"/"Purchase", reaproveitado
   * aqui pra fechar o funil desde o clique no anúncio: sem isso, uma
   * campanha que manda tráfego pra este catálogo (em vez de Clique-para-
   * WhatsApp direto) não tinha nenhum sinal de conversão pra otimizar,
   * só visualização de página. Ausente = tenant sem CAPI configurado,
   * frontend simplesmente não carrega pixel nenhum.
   */
  pixelId?: string;
}

/**
 * Os dados de contato públicos ficam em colunas explícitas do tenant, não
 * hardcoded no frontend ou misturados às regras internas da Base de
 * Conhecimento. Assim cada cliente poderá administrar seu próprio catálogo.
 */

function normalizeSlug(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized) ? normalized : null;
}

async function publicBeforeAfterPair(pair: BeforeAfterPair): Promise<PublicBeforeAfterPair | null> {
  const [beforeImageUrl, afterImageUrl] = await Promise.all([
    buildCatalogThumbnail(pair.beforeImageBase64),
    buildCatalogThumbnail(pair.afterImageBase64),
  ]);
  if (!beforeImageUrl || !afterImageUrl) return null;
  return {
    id: pair.id,
    beforeImageUrl,
    afterImageUrl,
    caption: pair.caption?.trim() || undefined,
  };
}

async function publicBeforeAfterPairs(pairs?: BeforeAfterPair[]): Promise<PublicBeforeAfterPair[] | undefined> {
  if (!pairs?.length) return undefined;
  const converted = await Promise.all(pairs.map(publicBeforeAfterPair));
  const valid = converted.filter((pair): pair is PublicBeforeAfterPair => pair !== null);
  return valid.length ? valid : undefined;
}

async function publicVariant(variant: ProductVariant): Promise<PublicCatalogVariant> {
  const currentPrice = resolveVariantPrice(variant);
  const amount = resolveVariantPriceAmount(variant);
  return {
    code: variant.code,
    description: variant.description?.trim() || undefined,
    imageUrl: await buildCatalogThumbnail(variant.exampleImageBase64),
    whatsappMessage: variant.whatsappMessage?.trim() || undefined,
    beforeAfter: await publicBeforeAfterPairs(variant.beforeAfter),
    dimensions: variant.dimensions,
    litros: variant.litros,
    price: currentPrice,
    priceAmount: amount > 0 ? amount : undefined,
    durationMinutes: variant.durationMinutes,
  };
}

export async function toPublicCatalogProduct(product: AgentProduct, tenantCurrency: string): Promise<PublicCatalogProduct> {
  const currentPrice = resolveProductPrice(product);
  const amount = resolveProductPriceAmount(product);
  return {
    name: product.name,
    category: product.category,
    description: product.description,
    price: currentPrice,
    priceAmount: amount > 0 ? amount : undefined,
    currency: product.currency || tenantCurrency,
    durationMinutes: product.durationMinutes,
    variants: product.variants ? await Promise.all(product.variants.map(publicVariant)) : undefined,
    imageUrl: await buildCatalogThumbnail(product.exampleImageBase64),
    beforeAfter: await publicBeforeAfterPairs(product.beforeAfter),
  };
}

export async function toPublicCatalog(
  tenant: { name: string; slug: string; currency: string; locale: string; public_catalog_template?: string },
  products: AgentProduct[],
): Promise<PublicCatalog> {
  return {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
      locale: tenant.locale,
      template: tenant.public_catalog_template === 'gold_catalog' || tenant.public_catalog_template === 'beauty_concierge' ? tenant.public_catalog_template : 'default',
    },
    contact: {},
    // `active:false` é a mesma regra usada pelo agente: produto pausado não
    // deve ser ofertado ao público nem continuar aparecendo no atendimento.
    products: await Promise.all(
      products
        .filter((product) => product.active !== false)
        .map((product) => toPublicCatalogProduct(product, tenant.currency)),
    ),
  };
}

export async function getPublicCatalogBySlug(slug: string): Promise<PublicCatalog | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;

  const { data: tenant, error } = await getDb()
    .from('tenants')
    .select('id, name, slug, currency, locale, public_catalog_enabled, public_catalog_template, public_whatsapp_phone, public_instagram_url, public_location_maps_url, public_address, public_hours_label, public_whatsapp_message_general, public_whatsapp_message_product')
    .eq('slug', normalizedSlug)
    .maybeSingle();
  if (error) throw error;
  if (!tenant?.slug || tenant.public_catalog_enabled !== true) return null;

  const knowledgeBase = await getKnowledgeBase(tenant.id);
  if (!knowledgeBase) return null;

  const catalog = await toPublicCatalog(tenant, knowledgeBase.products || []);
  catalog.contact = {
    whatsappNumber: tenant.public_whatsapp_phone || undefined,
    instagramUrl: tenant.public_instagram_url || undefined,
    locationMapsUrl: tenant.public_location_maps_url || knowledgeBase.locationMapsUrl || undefined,
    addressLabel: tenant.public_address || undefined,
    hoursLabel: tenant.public_hours_label || undefined,
    whatsappMessageGeneral: tenant.public_whatsapp_message_general || undefined,
    whatsappMessageProduct: tenant.public_whatsapp_message_product || undefined,
  };

  // Só o dataset_id (Pixel ID) vai pro cliente — nunca o capi_access_token,
  // que é um segredo server-side (usado só por metaCapiService.ts).
  const { data: metaCredentials } = await getDb().from('tenant_meta_credentials').select('capi_dataset_id').eq('tenant_id', tenant.id).maybeSingle();
  catalog.pixelId = metaCredentials?.capi_dataset_id || undefined;

  return catalog;
}

export { normalizeSlug };
