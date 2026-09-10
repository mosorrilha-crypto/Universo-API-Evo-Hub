/**
 * TASK-0365 (pedido direto): "abra o gerenciador e verifique nos anúncios
 * qual está com esta msg" — quando um lead chega sem atribuição automática
 * de anúncio já gravada (ver TASK-0364), o operador cola a mensagem inicial
 * e o app procura entre os anúncios da conta Meta Ads conectada qual tem
 * essa mensagem configurada (campo `page_welcome_message` do creative,
 * confirmado como "mensagem inicial configurada no próprio anúncio").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { findAdsByWelcomeMessage, MetaAdsConfigurationError } from '../metaAdsInsightsService';

const TENANT = '8a786c2a-aa8c-4c2a-bc12-d50058c598ce';
const realFetch = global.fetch;

beforeEach(() => {
  const db = createFakeSupabase();
  initDb(db);
});

afterEach(() => {
  global.fetch = realFetch;
});

async function seedCredentials() {
  const db = createFakeSupabase();
  initDb(db);
  await db.from('tenant_meta_credentials').insert({
    tenant_id: TENANT,
    meta_ads_account_id: 'act_677275869339059',
    meta_ads_access_token: 'token-plaintext-de-teste',
  });
  return db;
}

describe('findAdsByWelcomeMessage', () => {
  it('lança MetaAdsConfigurationError quando o tenant não tem conta Meta Ads conectada', async () => {
    await expect(findAdsByWelcomeMessage(TENANT, 'oi')).rejects.toThrow(MetaAdsConfigurationError);
  });

  it('encontra o anúncio cujo page_welcome_message bate com o texto informado', async () => {
    const db = await seedCredentials();
    initDb(db);

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'ad-1',
            name: 'Combo Cejas + Labios',
            effective_status: 'ACTIVE',
            campaign: { name: 'Campanha Setembro' },
            creative: {
              object_story_spec: {
                link_data: {
                  page_welcome_message: JSON.stringify({ type: 'VISUAL_EDITOR', text: { content: '¡Hola! Quiero más información' } }),
                },
              },
            },
          },
          {
            id: 'ad-2',
            name: 'Outro anúncio sem relação',
            effective_status: 'PAUSED',
            campaign: { name: 'Campanha Antiga' },
            creative: { object_story_spec: { link_data: { page_welcome_message: JSON.stringify({ text: { content: 'Oi, quero saber o preço da promoção' } }) } } },
          },
        ],
      }),
    })) as any;

    const matches = await findAdsByWelcomeMessage(TENANT, '¡Hola! Quiero más información');

    expect(matches).toHaveLength(1);
    expect(matches[0].adId).toBe('ad-1');
    expect(matches[0].adName).toBe('Combo Cejas + Labios');
    expect(matches[0].campaignName).toBe('Campanha Setembro');
    expect(matches[0].matchedSnippet).toContain('¡Hola! Quiero más información');
  });

  it('busca é case-insensitive e não distingue acentuação exata de maiúsculas/minúsculas', async () => {
    const db = await seedCredentials();
    initDb(db);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'ad-1', name: 'Anúncio X', creative: { object_story_spec: { link_data: { page_welcome_message: 'Hola! QUIERO más informacion' } } } },
        ],
      }),
    })) as any;

    const matches = await findAdsByWelcomeMessage(TENANT, 'quiero MÁS informacion');
    expect(matches).toHaveLength(1);
  });

  it('não encontra nada quando nenhum anúncio tem essa mensagem', async () => {
    const db = await seedCredentials();
    initDb(db);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'ad-1', name: 'Anúncio X', creative: { object_story_spec: { link_data: { message: 'Texto qualquer' } } } }] }) })) as any;

    const matches = await findAdsByWelcomeMessage(TENANT, 'frase que não existe em nenhum anúncio');
    expect(matches).toHaveLength(0);
  });

  it('também busca dentro de asset_feed_spec (Advantage+ / criativo dinâmico)', async () => {
    const db = await seedCredentials();
    initDb(db);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 'ad-1', name: 'Anúncio Advantage+', creative: { asset_feed_spec: { bodies: [{ text: 'Promo Unhas em Gel' }] } } }],
      }),
    })) as any;

    const matches = await findAdsByWelcomeMessage(TENANT, 'Promo Unhas em Gel');
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedPath).toContain('asset_feed_spec');
  });
});
