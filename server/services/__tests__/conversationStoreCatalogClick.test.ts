/**
 * attachCatalogClickIfMatched: liga uma conversa a um clique real do
 * catálogo (código de emojis, ver publicCatalogClickStore.ts) — diferente
 * de shouldBlockForAdsOnlyMode, precisa rodar mesmo em tenant SEM o modo
 * "somente anúncios" ligado, senão a contagem "clique virou conversa" nunca
 * fecha pra esses tenants (pedido real, 25/08/2026).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordCatalogWhatsappClick, matchCatalogClickCode } from '../publicCatalogClickStore';
import { recordIncomingMessage, attachCatalogClickIfMatched, getConversationAdGreetingMatched } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('attachCatalogClickIfMatched', () => {
  it('liga a conversa ao clique mesmo sem ads_only ligado, e consome o clique (não fica mais disponível pra outra mensagem)', async () => {
    const click = await recordCatalogWhatsappClick(TENANT_A, 'Hola, quiero información sobre Combo Full Face');
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: click.message, timestamp: '10:00' });

    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(false);
    await attachCatalogClickIfMatched(TENANT_A, PHONE, click.message);
    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(true);

    // o clique já foi consumido — não é mais candidato pra outra conversa
    expect(await matchCatalogClickCode(TENANT_A, click.message)).toBeUndefined();
  });

  it('sem code no texto, não faz nada (não lança, não marca a conversa)', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi, tudo bem?', timestamp: '10:00' });
    await attachCatalogClickIfMatched(TENANT_A, PHONE, 'oi, tudo bem?');
    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(false);
  });
});
