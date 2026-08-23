import { describe, expect, it } from 'vitest';
import {
  normalizeSlug,
  toPublicCatalog,
  toPublicCatalogProduct,
} from '../publicCatalogStore';

describe('publicCatalogStore', () => {
  it('normaliza apenas slugs seguros', () => {
    expect(normalizeSlug(' Monique-Beauty ')).toBe('monique-beauty');
    expect(normalizeSlug('monique/../outro')).toBeNull();
    expect(normalizeSlug('')).toBeNull();
    expect(normalizeSlug('áudio')).toBeNull();
  });

  it('publica somente campos comerciais e filtra produtos inativos', () => {
    const catalog = toPublicCatalog(
      { name: 'Monique', slug: 'monique', currency: 'PYG', locale: 'es-PY' },
      [
        {
          name: 'Microlips Labios',
          aliases: ['Microlips'],
          price: 'Gs 550.000',
          priceAmount: 550000,
          category: 'Labios',
          description: 'Cor natural e definida.',
          durationMinutes: 120,
          bookable: true,
          exampleImageBase64: 'data:image/png;base64,private',
          exampleVideoId: 'private-video-id',
        },
        {
          name: 'Item pausado',
          price: 'Gs 1',
          active: false,
        },
      ],
    );

    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0]).toEqual({
      name: 'Microlips Labios',
      category: 'Labios',
      description: 'Cor natural e definida.',
      price: 'Gs 550.000',
      priceAmount: 550000,
      currency: 'PYG',
      durationMinutes: 120,
      variants: undefined,
    });
    expect(catalog).not.toHaveProperty('agentGoal');
    expect(catalog).not.toHaveProperty('pricingAndPolicies');
  });

  it('preserva variantes comerciais sem transportar aliases ou mídia privada', () => {
    const product = toPublicCatalogProduct(
      {
        name: 'Pestañas',
        aliases: ['Efecto 30+'],
        price: 'Consultar',
        category: 'Pestañas',
        description: 'Família de serviços.',
        variants: [{ code: 'Efecto 30+', price: 'Gs 350.000', priceAmount: 350000, durationMinutes: 120, bookable: false }],
      },
      'PYG',
    );

    expect(product.variants).toEqual([
      { code: 'Efecto 30+', price: 'Gs 350.000', priceAmount: 350000, durationMinutes: 120 },
    ]);
    expect(product).not.toHaveProperty('aliases');
  });
});
