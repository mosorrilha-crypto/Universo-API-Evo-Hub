import { describe, expect, it, vi } from 'vitest';

// PNG 1x1 mínimo válido — só precisa ser uma imagem decodificável pelo sharp.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// TASK-0218: mesmo contrato real de resolveKnowledgeBaseImageBinary — sem
// fetch() de verdade, devolve a mesma imagem de teste quando há imageId.
const resolveKnowledgeBaseImageBinary = vi.fn(async (_url?: string, _key?: string, _tenantId?: string, imageId?: string, mimeType?: string, legacyBase64?: string) => {
  if (imageId) return { buffer: Buffer.from(TINY_PNG_BASE64, 'base64'), mimeType: mimeType || 'image/png' };
  if (legacyBase64) return { buffer: Buffer.from(legacyBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'), mimeType: mimeType || 'image/png' };
  return null;
});
vi.mock('../knowledgeBaseImageStore', () => ({ resolveKnowledgeBaseImageBinary }));

const {
  normalizeSlug,
  toPublicCatalog,
  toPublicCatalogProduct,
} = await import('../publicCatalogStore');

describe('publicCatalogStore', () => {
  it('normaliza apenas slugs seguros', () => {
    expect(normalizeSlug(' Monique-Beauty ')).toBe('monique-beauty');
    expect(normalizeSlug('monique/../outro')).toBeNull();
    expect(normalizeSlug('')).toBeNull();
    expect(normalizeSlug('áudio')).toBeNull();
  });

  it('publica somente campos comerciais e filtra produtos inativos', async () => {
    const catalog = await toPublicCatalog(
      { id: 'tenant-1', name: 'Monique', slug: 'monique', currency: 'PYG', locale: 'es-PY' },
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
      { supabaseUrl: undefined, supabaseKey: undefined },
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
        beforeAfter: [{
          id: 'pestanas-resultado-1',
          beforeImageBase64: `data:image/png;base64,${tinyPngBase64}`,
          afterImageBase64: `data:image/png;base64,${tinyPngBase64}`,
          caption: 'Resultado adaptado a la mirada.',
        }],
        variants: [{
          code: 'Efecto 30+',
          description: 'Máximo volume e retenção de até 30 dias.',
          whatsappMessage: 'Hola, quiero información sobre {produto}.',
          exampleImageBase64: `data:image/png;base64,${tinyPngBase64}`,
          exampleImageMimeType: 'image/png',
          exampleVideoId: 'private-variant-video-id',
          beforeAfter: [{
            id: 'efecto-30-resultado-1',
            beforeImageBase64: `data:image/png;base64,${tinyPngBase64}`,
            afterImageBase64: `data:image/png;base64,${tinyPngBase64}`,
            caption: 'Volumen con acabado intenso.',
          }],
          price: 'Gs 350.000',
          priceAmount: 350000,
          durationMinutes: 120,
          bookable: false,
        }],
      },
      'PYG',
      { supabaseUrl: undefined, supabaseKey: undefined, tenantId: 'tenant-1' },
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
    expect(product.beforeAfter?.[0]).toMatchObject({
      id: 'pestanas-resultado-1',
      caption: 'Resultado adaptado a la mirada.',
      beforeImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      afterImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(product.variants?.[0].beforeAfter?.[0]).toMatchObject({
      id: 'efecto-30-resultado-1',
      caption: 'Volumen con acabado intenso.',
      beforeImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      afterImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
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
      { supabaseUrl: undefined, supabaseKey: undefined, tenantId: 'tenant-1' },
    );

    expect(product.imageUrl).toBeDefined();
    expect(product.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(product).not.toHaveProperty('exampleImageBase64');
  });

  // TASK-0218: produto/variante/antes-depois já migrados pro Storage
  // (exampleImageId/beforeImageId/afterImageId, sem Base64 legado nenhum) —
  // a miniatura ainda precisa sair comprimida, resolvendo o binário via
  // resolveKnowledgeBaseImageBinary antes de comprimir.
  it('publica miniatura comprimida quando a foto já está no Storage (exampleImageId/beforeImageId/afterImageId, sem Base64 legado)', async () => {
    resolveKnowledgeBaseImageBinary.mockClear();
    const product = await toPublicCatalogProduct(
      {
        name: 'Cejas — Diseño & Tratamientos',
        price: 'Gs 60.000',
        exampleImageId: 'image-storage-product',
        exampleImageMimeType: 'image/png',
        beforeAfter: [{ id: 'ba1', beforeImageId: 'image-storage-before', afterImageId: 'image-storage-after' }],
        variants: [{ code: 'V1', price: 'Gs 40.000', exampleImageId: 'image-storage-variant' }],
      },
      'PYG',
      { supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key', tenantId: 'tenant-1' },
    );

    expect(product.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(product.beforeAfter?.[0]).toMatchObject({
      beforeImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      afterImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(product.variants?.[0].imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(resolveKnowledgeBaseImageBinary).toHaveBeenCalledWith(
      'https://fake.supabase.co', 'fake-key', 'tenant-1', 'image-storage-product', 'image/png', undefined, 'publicCatalogStore:thumbnail'
    );
  });

  it('produto sem foto nenhuma (nem imageId nem Base64) fica sem imageUrl, sem quebrar', async () => {
    const product = await toPublicCatalogProduct(
      { name: 'Sem foto', price: 'Gs 10.000' },
      'PYG',
      { supabaseUrl: undefined, supabaseKey: undefined, tenantId: 'tenant-1' },
    );
    expect(product.imageUrl).toBeUndefined();
  });
});
