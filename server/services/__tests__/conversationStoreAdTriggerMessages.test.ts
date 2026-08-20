/**
 * shouldBlockForAdsOnlyMode: gate combinado do modo "somente anúncios" —
 * ctwa_clid real OU texto da mensagem batendo com um gatilho configurado
 * (ver agentStatusAdTriggerMessages.test.ts) libera a resposta automática;
 * uma vez identificada como anúncio, a conversa inteira fica liberada, não
 * só a mensagem que bateu com o gatilho.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { setAdsOnlyMode, setAdTriggerMessages } from '../agentStatus';
import {
  recordIncomingMessage,
  attachAdReferralIfMissing,
  shouldBlockForAdsOnlyMode,
  getConversationAdGreetingMatched,
  updateConversationState,
} from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';
const TRIGGER = 'Me gustaría reservar un horario para el combo de cejas y labios 💕';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('shouldBlockForAdsOnlyMode', () => {
  it('nunca bloqueia quando ads_only está desligado', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'oi')).toBe(false);
  });

  it('bloqueia contato pessoal (sem ctwa_clid nem gatilho batendo) quando ads_only está ligado', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi, tudo bem?', timestamp: '10:00' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'oi, tudo bem?')).toBe(true);
  });

  it('libera quando a conversa já tem ctwa_clid real gravado', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await attachAdReferralIfMissing(TENANT_A, PHONE, { ctwaClid: 'clid-real-123' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'oi')).toBe(false);
  });

  it('libera e marca a conversa quando o texto bate com um gatilho configurado', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await setAdTriggerMessages(TENANT_A, [TRIGGER]);
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: TRIGGER, timestamp: '10:00' });

    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(false);
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, TRIGGER)).toBe(false);
    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(true);
  });

  it('depois de marcada pelo gatilho, mensagens seguintes da mesma conversa continuam liberadas mesmo sem bater no gatilho de novo', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await setAdTriggerMessages(TENANT_A, [TRIGGER]);
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: TRIGGER, timestamp: '10:00' });
    await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, TRIGGER); // 1ª mensagem, marca a conversa

    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'Sí, para el sábado a las 15h', timestamp: '10:05' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'Sí, para el sábado a las 15h')).toBe(false);
  });

  it('operador pode sinalizar manualmente um lead como vindo de anúncio (updateConversationState adLead), liberando a resposta automática sem precisar de ctwa_clid nem gatilho de texto', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'Buenas precio??', timestamp: '10:00' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'Buenas precio??')).toBe(true);

    const updated = await updateConversationState(TENANT_A, PHONE, { adLead: true });
    expect(updated?.adGreetingMatchedAt).toBeTruthy();
    expect(await getConversationAdGreetingMatched(TENANT_A, PHONE)).toBe(true);
    expect(await shouldBlockForAdsOnlyMode(TENANT_A, PHONE, 'Buenas precio??')).toBe(false);
  });

  it('outro tenant com o mesmo gatilho configurado não vaza pro tenant que não tem', async () => {
    const TENANT_B = '22222222-2222-2222-2222-222222222222';
    await setAdsOnlyMode(TENANT_B, true);
    await recordIncomingMessage(TENANT_B, PHONE, undefined, { type: 'text', text: TRIGGER, timestamp: '10:00' });
    expect(await shouldBlockForAdsOnlyMode(TENANT_B, PHONE, TRIGGER)).toBe(true);
  });
});
