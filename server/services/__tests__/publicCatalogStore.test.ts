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

  it('publica somente campos comerciais e filtra produtos inativos', async () => {
    const catalog = await toPublicCatalog(
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
      imageUrl: undefined,
    });
    expect(catalog).not.toHaveProperty('agentGoal');
    expect(catalog).not.toHaveProperty('pricingAndPolicies');
  });

  it('preserva foto pública comprimida e mensagem comercial por variante sem transportar o vídeo privado', async () => {
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const product = await toPublicCatalogProduct(
      {
        name: 'Pestañas',
        aliases: ['Efecto 30+'],
        price: 'Consultar',
        category: 'Pestañas',
        description: 'Família de serviços.',
        variants: [{
          code: 'Efecto 30+',
          description: 'Máximo volume e retenção de até 30 dias.',
          whatsappMessage: 'Hola, quiero información sobre {produto}.',
          exampleImageBase64: `data:image/png;base64,${tinyPngBase64}`,
          exampleImageMimeType: 'image/png',
          exampleVideoId: 'private-variant-video-id',
          price: 'Gs 350.000',
          priceAmount: 350000,
          durationMinutes: 120,
          bookable: false,
        }],
      },
      'PYG',
    );

    expect(product.variants?.[0]).toMatchObject({
      code: 'Efecto 30+',
      description: 'Máximo volume e retenção de até 30 dias.',
      whatsappMessage: 'Hola, quiero información sobre {produto}.',
      price: 'Gs 350.000',
      priceAmount: 350000,
      durationMinutes: 120,
      imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(product.variants?.[0]).not.toHaveProperty('exampleVideoId');
    expect(product).not.toHaveProperty('aliases');
  });

  it('publica uma miniatura comprimida derivada da foto de exemplo, nunca o base64 original', async () => {
    // PNG 1x1 mínimo válido — só precisa ser uma imagem decodificável pelo sharp.
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const product = await toPublicCatalogProduct(
      {
        name: 'Cejas — Diseño & Tratamientos',
        price: 'Gs 60.000',
        exampleImageBase64: `data:image/png;base64,${tinyPngBase64}`,
        exampleImageMimeType: 'image/png',
      },
      'PYG',
    );

    expect(product.imageUrl).toBeDefined();
    expect(product.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(product).not.toHaveProperty('exampleImageBase64');
  });
});
