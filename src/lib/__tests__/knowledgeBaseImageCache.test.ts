/**
 * TASK-0218 — achado da própria auditoria: a limpeza de Base64 legado do
 * cache local (App.tsx, pra evitar o estouro real de cota de localStorage já
 * documentado no Epic 4.5.2) só cobria `exampleImageBase64` do produto pai,
 * nunca de variante/antes-depois/bloco de 1º contato. Trava o comportamento
 * correto: remove o Base64 grande de TODOS os pontos, preserva tudo que é
 * pequeno e seguro (ids de Storage, mimeType, preço, etc.).
 */
import { describe, expect, it } from 'vitest';
import { stripLegacyImageBase64, stripLegacyImageBase64FromProduct, stripLegacyImageBase64FromVariant } from '../knowledgeBaseImageCache';

describe('stripLegacyImageBase64FromProduct', () => {
  it('remove o Base64 legado do produto, da variante e dos dois pares antes/depois (produto e variante) — preserva tudo mais', () => {
    const product = {
      id: 'prod-1',
      name: 'Microlips',
      price: 'Gs 500.000',
      description: '',
      exampleImageId: 'image-storage-1',
      exampleImageMimeType: 'image/jpeg',
      exampleImageBase64: 'data:image/jpeg;base64,AAAA',
      beforeAfter: [{ id: 'ba1', beforeImageId: 'image-before-1', beforeImageBase64: 'data:image/jpeg;base64,BBBB', afterImageBase64: 'data:image/jpeg;base64,CCCC' }],
      variants: [{
        code: 'V1',
        price: 'Gs 400.000',
        exampleImageId: 'image-variant-1',
        exampleImageBase64: 'data:image/jpeg;base64,DDDD',
        beforeAfter: [{ id: 'ba2', afterImageId: 'image-variant-after-1', beforeImageBase64: 'data:image/jpeg;base64,EEEE', afterImageBase64: 'data:image/jpeg;base64,FFFF' }],
      }],
    } as any;

    const result = stripLegacyImageBase64FromProduct(product);

    expect(result).not.toHaveProperty('exampleImageBase64');
    expect(result.exampleImageId).toBe('image-storage-1');
    expect(result.exampleImageMimeType).toBe('image/jpeg');
    expect(result.name).toBe('Microlips');

    expect(result.beforeAfter?.[0]).not.toHaveProperty('beforeImageBase64');
    expect(result.beforeAfter?.[0]).not.toHaveProperty('afterImageBase64');
    expect(result.beforeAfter?.[0].beforeImageId).toBe('image-before-1');

    expect(result.variants?.[0]).not.toHaveProperty('exampleImageBase64');
    expect(result.variants?.[0].exampleImageId).toBe('image-variant-1');
    expect(result.variants?.[0].beforeAfter?.[0]).not.toHaveProperty('beforeImageBase64');
    expect(result.variants?.[0].beforeAfter?.[0]).not.toHaveProperty('afterImageBase64');
    expect(result.variants?.[0].beforeAfter?.[0].afterImageId).toBe('image-variant-after-1');
  });

  it('produto sem variantes/antes-depois não quebra (campos ausentes ficam ausentes)', () => {
    const product = { id: 'prod-1', name: 'Sem extras', price: 'Gs 1', description: '' } as any;
    const result = stripLegacyImageBase64FromProduct(product);
    expect(result.variants).toBeUndefined();
    expect(result.beforeAfter).toBeUndefined();
  });

  it('produto já migrado (sem nenhum Base64 legado) fica intacto', () => {
    const product = { id: 'prod-1', name: 'Migrado', price: 'Gs 1', description: '', exampleImageId: 'image-1' } as any;
    const result = stripLegacyImageBase64FromProduct(product);
    expect(result.exampleImageId).toBe('image-1');
  });
});

describe('stripLegacyImageBase64FromVariant / stripLegacyImageBase64 (par antes/depois)', () => {
  it('stripLegacyImageBase64 remove só os dois campos de Base64 do par, preserva o resto', () => {
    const pair = { id: 'ba1', beforeImageId: 'img-before', beforeImageBase64: 'AAAA', afterImageBase64: 'BBBB', caption: 'Resultado' } as any;
    const result = stripLegacyImageBase64(pair);
    expect(result).not.toHaveProperty('beforeImageBase64');
    expect(result).not.toHaveProperty('afterImageBase64');
    expect(result.beforeImageId).toBe('img-before');
    expect(result.caption).toBe('Resultado');
  });

  it('stripLegacyImageBase64FromVariant remove o Base64 da variante e de cada par antes/depois dela', () => {
    const variant = {
      code: 'V1',
      price: 'Gs 1',
      exampleImageBase64: 'AAAA',
      beforeAfter: [{ id: 'ba1', beforeImageBase64: 'BBBB', afterImageBase64: 'CCCC' }],
    } as any;
    const result = stripLegacyImageBase64FromVariant(variant);
    expect(result).not.toHaveProperty('exampleImageBase64');
    expect(result.beforeAfter?.[0]).not.toHaveProperty('beforeImageBase64');
    expect(result.beforeAfter?.[0]).not.toHaveProperty('afterImageBase64');
  });
});
