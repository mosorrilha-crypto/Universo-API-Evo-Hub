import type { AgentProduct, ProductVariant, BeforeAfterPair } from '../types';

/**
 * TASK-0218: as fotos migradas pro Storage viram um id curto (`exampleImageId`
 * etc.) — seguro pro cache local (App.tsx), não estoura cota. Mas enquanto
 * nem todo tenant está migrado, o Base64 LEGADO (`exampleImageBase64` etc.)
 * ainda pode aparecer em qualquer um destes campos — não só no produto pai,
 * como a exclusão original (Epic 4.5.2) fazia. Achado da auditoria da
 * própria TASK-0218: variante, antes/depois (do produto E de cada variante)
 * e bloco de imagem do 1º contato nunca tinham essa limpeza, deixando o
 * mesmo risco de estouro de cota em aberto pra esses campos.
 *
 * Extraído de App.tsx pro seu próprio módulo (sem nenhuma dependência de
 * Firebase/rede) especificamente pra ser testável sozinho — App.tsx inteiro
 * não pode ser importado em teste sem credenciais reais de Firebase
 * configuradas (ver src/lib/firebase.ts).
 */
export function stripLegacyImageBase64(pair: BeforeAfterPair): BeforeAfterPair {
  const { beforeImageBase64, afterImageBase64, ...rest } = pair;
  return rest;
}

export function stripLegacyImageBase64FromVariant(variant: ProductVariant): ProductVariant {
  const { exampleImageBase64, ...rest } = variant;
  return {
    ...rest,
    beforeAfter: variant.beforeAfter?.map(stripLegacyImageBase64),
  };
}

export function stripLegacyImageBase64FromProduct(product: AgentProduct): AgentProduct {
  const { exampleImageBase64, ...rest } = product;
  return {
    ...rest,
    variants: product.variants?.map(stripLegacyImageBase64FromVariant),
    beforeAfter: product.beforeAfter?.map(stripLegacyImageBase64),
  };
}
