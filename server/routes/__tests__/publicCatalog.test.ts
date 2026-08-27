import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublicCatalogRouter } from '../publicCatalog';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server | undefined;
let baseUrl = '';

async function startServer(seed: Record<string, any[]>) {
  initDb(createFakeSupabase(seed));
  const app = express();
  app.use(createPublicCatalogRouter());
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const started = app.listen(0, () => {
      const address = started.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: started, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function completePublishedDocuments(tenantId: string, serviceCatalog: Record<string, unknown>) {
  const documentTypes = [
    'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
    'opening_hours', 'faq', 'human_handoff_rules', 'media_assets',
  ];
  return documentTypes.map((documentType) => ({
    id: `${tenantId}-${documentType}`,
    tenant_id: tenantId,
    document_type: documentType,
    version: 2,
    status: 'published',
    data: documentType === 'service_catalog' ? serviceCatalog : {},
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
    published_at: '2026-08-27T00:00:00.000Z',
  }));
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('GET /api/public/catalog/:slug', () => {
  it('publica somente um tenant explicitamente habilitado e retorna campos comerciais', async () => {
    ({ server, baseUrl } = await startServer({
      tenants: [{
        id: 'tenant-monique',
        name: 'Monique',
        slug: 'monique',
        currency: 'PYG',
        locale: 'es-PY',
        public_catalog_enabled: true,
        public_whatsapp_phone: '595981436141',
        public_instagram_url: 'https://instagram.com/pestanaspormonique',
      }],
      knowledge_base: [{
        tenant_id: 'tenant-monique',
        data: {
          agentGoal: 'não publicar',
          pricingAndPolicies: 'não publicar',
          products: [
            { name: 'Microlips', price: 'Gs 550.000', priceAmount: 550000, category: 'Labios', description: 'Serviço público' },
            { name: 'Pausado', price: 'Gs 1', active: false },
          ],
        },
      }],
    }));

    const response = await fetch(`${baseUrl}/api/public/catalog/monique`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=60');
    const body = await response.json();

    expect(body.catalog.tenant).toEqual({ name: 'Monique', slug: 'monique', currency: 'PYG', locale: 'es-PY' });
    expect(body.catalog.contact).toMatchObject({
      whatsappNumber: '595981436141',
      instagramUrl: 'https://instagram.com/pestanaspormonique',
    });
    expect(body.catalog.products).toEqual([
      {
        name: 'Microlips',
        category: 'Labios',
        description: 'Serviço público',
        price: 'Gs 550.000',
        priceAmount: 550000,
        currency: 'PYG',
        durationMinutes: undefined,
        variants: undefined,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('não publicar');
  });

  it('não expõe tenant sem opt-in e não aceita slug inexistente', async () => {
    ({ server, baseUrl } = await startServer({
      tenants: [{ id: 'tenant-privado', name: 'Privado', slug: 'privado', currency: 'PYG', locale: 'es-PY', public_catalog_enabled: false }],
      knowledge_base: [{ tenant_id: 'tenant-privado', data: { products: [{ name: 'Privado', price: 'Gs 1' }] } }],
    }));

    const privateResponse = await fetch(`${baseUrl}/api/public/catalog/privado`);
    const missingResponse = await fetch(`${baseUrl}/api/public/catalog/desconhecido`);
    expect(privateResponse.status).toBe(404);
    expect(missingResponse.status).toBe(404);
  });

  it('usa o catálogo da publicação tipada, não o preço defasado do blob de rollback', async () => {
    ({ server, baseUrl } = await startServer({
      tenants: [{ id: 'tenant-monique', name: 'Monique', slug: 'monique', currency: 'PYG', locale: 'es-PY', public_catalog_enabled: true }],
      knowledge_base: [{
        tenant_id: 'tenant-monique',
        data: { products: [{ name: 'Microlips', price: 'Gs 550.000', priceAmount: 550000 }] },
      }],
      knowledge_base_documents: completePublishedDocuments('tenant-monique', {
        products: [{ name: 'Microlips', price: 'Gs 600.000', priceAmount: 600000, description: 'Preço publicado.' }],
      }),
    }));

    const response = await fetch(`${baseUrl}/api/public/catalog/monique`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.catalog.products).toEqual([expect.objectContaining({
      name: 'Microlips', price: 'Gs 600.000', priceAmount: 600000, description: 'Preço publicado.',
    })]);
    expect(JSON.stringify(body)).not.toContain('550.000');
  });
});

describe('GET /api/public/catalog/:slug/whatsapp-click', () => {
  it('registra o clique, redireciona (302) pro WhatsApp com o code de emojis embutido na mensagem', async () => {
    const seed = {
      tenants: [{
        id: 'tenant-monique',
        slug: 'monique',
        public_catalog_enabled: true,
        public_whatsapp_phone: '595981436141',
      }],
    };
    ({ server, baseUrl } = await startServer(seed));

    const response = await fetch(`${baseUrl}/api/public/catalog/monique/whatsapp-click?msg=${encodeURIComponent('Hola, quiero información sobre Combo Full Face')}&product=${encodeURIComponent('Combo Full Face')}`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = response.headers.get('location')!;
    expect(location.startsWith('https://wa.me/595981436141?text=')).toBe(true);
    const message = decodeURIComponent(location.split('text=')[1]);
    expect(message.startsWith('Hola, quiero información sobre Combo Full Face ')).toBe(true);
    expect(message).not.toBe('Hola, quiero información sobre Combo Full Face '); // tem algo (o code) depois do espaço
  });

  it('remove espaços do telefone antes de montar o link do wa.me (achado de auditoria, 27/08/2026: número salvo como "595994 798081" gerava wa.me/595994%20798081, inválido pro WhatsApp)', async () => {
    const seed = {
      tenants: [{
        id: 'tenant-monique',
        slug: 'monique',
        public_catalog_enabled: true,
        public_whatsapp_phone: '595994 798081',
      }],
    };
    ({ server, baseUrl } = await startServer(seed));

    const response = await fetch(`${baseUrl}/api/public/catalog/monique/whatsapp-click?msg=${encodeURIComponent('oi')}`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = response.headers.get('location')!;
    expect(location.startsWith('https://wa.me/595994798081?text=')).toBe(true);
  });

  it('404 pra slug sem catálogo habilitado ou sem telefone configurado', async () => {
    ({ server, baseUrl } = await startServer({
      tenants: [{ id: 'tenant-x', slug: 'sem-telefone', public_catalog_enabled: true, public_whatsapp_phone: null }],
    }));

    const noPhone = await fetch(`${baseUrl}/api/public/catalog/sem-telefone/whatsapp-click?msg=oi`, { redirect: 'manual' });
    const missing = await fetch(`${baseUrl}/api/public/catalog/desconhecido/whatsapp-click?msg=oi`, { redirect: 'manual' });
    expect(noPhone.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it('400 quando a mensagem (msg) está ausente', async () => {
    ({ server, baseUrl } = await startServer({
      tenants: [{ id: 'tenant-monique', slug: 'monique', public_catalog_enabled: true, public_whatsapp_phone: '595981436141' }],
    }));

    const response = await fetch(`${baseUrl}/api/public/catalog/monique/whatsapp-click`, { redirect: 'manual' });
    expect(response.status).toBe(400);
  });
});
