/**
 * TASK-0364: `attachAdReferralIfMissing` passou a aceitar `adHeadline`/
 * `adSourceId` sem `ctwaClid` — necessário pra Evolution API, que não tem o
 * campo ctwa_clid da Meta Cloud API (ver extractEvolutionAdReferral em
 * webhookParsers.ts). Continua gravando só uma vez (nunca sobrescreve um
 * valor já gravado) e continua sem afetar `shouldBlockForAdsOnlyMode`, que
 * exige um ctwa_clid real de propósito (gate diferente, fora de escopo desta
 * tarefa — ver conversationStoreAdTriggerMessages.test.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, attachAdReferralIfMissing, getConversation, shouldBlockForAdsOnlyMode } from '../conversationStore';
import { setAdsOnlyMode } from '../agentStatus';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('attachAdReferralIfMissing — headline/sourceId sem ctwaClid (Evolution API)', () => {
  it('grava adHeadline/adSourceId mesmo sem ctwaClid', async () => {
    await recordIncomingMessage(TENANT, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await attachAdReferralIfMissing(TENANT, PHONE, { adHeadline: 'Combo Cejas + Labios', adSourceId: '12345' });

    const conv = await getConversation(TENANT, PHONE);
    expect(conv?.adHeadline).toBe('Combo Cejas + Labios');
  });

  it('não sobrescreve um adHeadline já gravado', async () => {
    await recordIncomingMessage(TENANT, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await attachAdReferralIfMissing(TENANT, PHONE, { adHeadline: 'Primeiro anúncio' });
    await attachAdReferralIfMissing(TENANT, PHONE, { adHeadline: 'Segundo anúncio (não devia sobrescrever)' });

    const conv = await getConversation(TENANT, PHONE);
    expect(conv?.adHeadline).toBe('Primeiro anúncio');
  });

  it('referral totalmente vazio (sem ctwaClid, adSourceId nem adHeadline) não grava nada', async () => {
    await recordIncomingMessage(TENANT, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await attachAdReferralIfMissing(TENANT, PHONE, {});

    const conv = await getConversation(TENANT, PHONE);
    expect(conv?.adHeadline).toBeUndefined();
  });

  it('adHeadline sem ctwaClid NÃO libera o modo somente-anúncios (gate exige ctwa_clid real, fora de escopo desta tarefa)', async () => {
    await setAdsOnlyMode(TENANT, true);
    await recordIncomingMessage(TENANT, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await attachAdReferralIfMissing(TENANT, PHONE, { adHeadline: 'Combo Cejas + Labios' });

    expect(await shouldBlockForAdsOnlyMode(TENANT, PHONE, 'oi')).toBe(true);
  });
});
