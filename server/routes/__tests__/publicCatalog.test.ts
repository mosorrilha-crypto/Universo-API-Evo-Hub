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
});
