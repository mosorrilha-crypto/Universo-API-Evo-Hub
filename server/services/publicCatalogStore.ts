import { getDb } from './db';
import {
  getKnowledgeBase,
  resolveProductPrice,
  resolveProductPriceAmount,
  resolveVariantPrice,
  resolveVariantPriceAmount,
  type AgentProduct,
  type ProductVariant,
} from './knowledgeBaseStore';

export interface PublicCatalogVariant {
  code: string;
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
}

export interface PublicCatalog {
  tenant: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
  };
  contact: {
    whatsappNumber?: string;
    instagramUrl?: string;
    locationMapsUrl?: string;
    addressLabel?: string;
    hoursLabel?: string;
  };
  products: PublicCatalogProduct[];
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

function publicVariant(variant: ProductVariant): PublicCatalogVariant {
  const currentPrice = resolveVariantPrice(variant);
  const amount = resolveVariantPriceAmount(variant);
  return {
    code: variant.code,
    dimensions: variant.dimensions,
    litros: variant.litros,
    price: currentPrice,
    priceAmount: amount > 0 ? amount : undefined,
    durationMinutes: variant.durationMinutes,
  };
}

export function toPublicCatalogProduct(product: AgentProduct, tenantCurrency: string): PublicCatalogProduct {
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
    variants: product.variants?.map(publicVariant),
  };
}

export function toPublicCatalog(
  tenant: { name: string; slug: string; currency: string; locale: string },
  products: AgentProduct[],
): PublicCatalog {
  return {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
      locale: tenant.locale,
    },
    contact: {},
    // `active:false` é a mesma regra usada pelo agente: produto pausado não
    // deve ser ofertado ao público nem continuar aparecendo no atendimento.
    products: products
      .filter((product) => product.active !== false)
      .map((product) => toPublicCatalogProduct(product, tenant.currency)),
  };
}

export async function getPublicCatalogBySlug(slug: string): Promise<PublicCatalog | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;

  const { data: tenant, error } = await getDb()
    .from('tenants')
    .select('id, name, slug, currency, locale, public_catalog_enabled, public_whatsapp_phone, public_instagram_url, public_location_maps_url, public_address, public_hours_label')
    .eq('slug', normalizedSlug)
    .maybeSingle();
  if (error) throw error;
  if (!tenant?.slug || tenant.public_catalog_enabled !== true) return null;

  const knowledgeBase = await getKnowledgeBase(tenant.id);
  if (!knowledgeBase) return null;

  const catalog = toPublicCatalog(tenant, knowledgeBase.products || []);
  catalog.contact = {
    whatsappNumber: tenant.public_whatsapp_phone || undefined,
    instagramUrl: tenant.public_instagram_url || undefined,
    locationMapsUrl: tenant.public_location_maps_url || knowledgeBase.locationMapsUrl || undefined,
    addressLabel: tenant.public_address || undefined,
    hoursLabel: tenant.public_hours_label || undefined,
  };
  return catalog;
}

export { normalizeSlug };
