/**
 * Contador interno de clique nos botões de WhatsApp do catálogo público —
 * pedido real (25/08/2026): saber quantos cliques viram conversa de
 * verdade, sem depender do Meta Pixel (nunca chega no backend) nem do
 * reconhecimento por prefixo de texto (frágil).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  recordCatalogWhatsappClick,
  matchCatalogClickCode,
  consumeCatalogClick,
  resolveCatalogWhatsappTarget,
} from '../publicCatalogClickStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('resolveCatalogWhatsappTarget', () => {
  it('resolve tenant_id + telefone só pra tenant com catálogo habilitado e telefone configurado', async () => {
    initDb(createFakeSupabase({
      tenants: [
        { id: TENANT_A, slug: 'monique', public_catalog_enabled: true, public_whatsapp_phone: '595981436141' },
        { id: TENANT_B, slug: 'sem-telefone', public_catalog_enabled: true, public_whatsapp_phone: null },
      ],
    }));

    expect(await resolveCatalogWhatsappTarget('monique')).toEqual({ tenantId: TENANT_A, whatsappNumber: '595981436141' });
    expect(await resolveCatalogWhatsappTarget('sem-telefone')).toBeNull();
    expect(await resolveCatalogWhatsappTarget('inexistente')).toBeNull();
  });

  it('slug inválido nunca chega a consultar o banco', async () => {
    expect(await resolveCatalogWhatsappTarget('Slug Com Espaço!')).toBeNull();
  });
});

describe('recordCatalogWhatsappClick + matchCatalogClickCode', () => {
  it('grava o clique e devolve a mensagem original com o code de emojis embutido no final', async () => {
    const click = await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face');
    expect(click.message).toBe(`Hola, quiero información sobre Combo Full Face ${click.code}`);
    expect(click.code.length).toBeGreaterThan(0);
  });

  it('reconhece o code em qualquer parte do texto recebido, não só como prefixo — sobrevive a edição do cliente', async () => {
    const click = await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face', 'Combo Full Face');
    const editedText = `Buenas! ${click.message} y también quisiera saber de descuentos`;

    const match = await matchCatalogClickCode(TENANT_A, editedText);
    expect(match).toEqual({ id: click.id, product: 'Combo Full Face' });
  });

  it('sem code presente no texto, não encontra match', async () => {
    await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face');
    expect(await matchCatalogClickCode(TENANT_A, 'Hola, buenas tardes')).toBeUndefined();
  });

  it('depois de consumido (consumeCatalogClick), o mesmo clique não é candidato de novo pra outra mensagem', async () => {
    const click = await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face');
    await consumeCatalogClick(click.id, '595981111111');

    expect(await matchCatalogClickCode(TENANT_A, click.message)).toBeUndefined();
  });

  it('clique de um tenant nunca é reconhecido pelo code na mensagem de outro tenant', async () => {
    const click = await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face');
    expect(await matchCatalogClickCode(TENANT_B, click.message)).toBeUndefined();
  });

  it('grava a origem do clique (legacy/novo/direct) quando informada — usado pra comparar as páginas/CTAs de catálogo', async () => {
    await recordCatalogWhatsappClick(TENANT_A, 'Hola', undefined, 'novo');
    const { getDb } = await import('../db');
    const { data } = await getDb().from('public_catalog_whatsapp_clicks').select('*').eq('tenant_id', TENANT_A);
    expect(data?.[0]?.source).toBe('novo');
  });

  it('grava origem "direct" — botão de WhatsApp direto na primeira dobra do Beauty Concierge (TASK-0125)', async () => {
    await recordCatalogWhatsappClick(TENANT_A, 'Hola Monique, vi tu catálogo', undefined, 'direct');
    const { getDb } = await import('../db');
    const { data } = await getDb().from('public_catalog_whatsapp_clicks').select('*').eq('tenant_id', TENANT_A);
    expect(data?.[0]?.source).toBe('direct');
  });
});
