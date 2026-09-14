/**
 * TASK-0416 — markSpecialistInvoked/StoredConversation.specialistInvokedAt:
 * sinal de "generateSpecialistReply já rodou de verdade nesta conversa",
 * separado de `history.length===0` (que não basta quando uma Mensagem de
 * Primeiro Contato fixa ou um operador escreveram antes de qualquer lead —
 * ver o mesmo achado documentado em autoReply.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, markSpecialistInvoked, getConversation } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('markSpecialistInvoked', () => {
  it('undefined por padrão numa conversa nova', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    const conv = await getConversation(TENANT_A, PHONE);
    expect(conv?.specialistInvokedAt).toBeUndefined();
  });

  it('grava um timestamp na 1ª chamada', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await markSpecialistInvoked(TENANT_A, PHONE);
    const conv = await getConversation(TENANT_A, PHONE);
    expect(conv?.specialistInvokedAt).toBeTruthy();
  });

  it('idempotente: chamadas seguintes não sobrescrevem o timestamp original', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await markSpecialistInvoked(TENANT_A, PHONE);
    const first = (await getConversation(TENANT_A, PHONE))?.specialistInvokedAt;

    await markSpecialistInvoked(TENANT_A, PHONE);
    const second = (await getConversation(TENANT_A, PHONE))?.specialistInvokedAt;

    expect(second).toBe(first);
  });

  it('isolado por tenant — marcar num tenant não vaza pro outro com o mesmo telefone', async () => {
    await recordIncomingMessage(TENANT_A, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_B, PHONE, undefined, { type: 'text', text: 'oi', timestamp: '10:00' });
    await markSpecialistInvoked(TENANT_A, PHONE);

    expect((await getConversation(TENANT_A, PHONE))?.specialistInvokedAt).toBeTruthy();
    expect((await getConversation(TENANT_B, PHONE))?.specialistInvokedAt).toBeUndefined();
  });
});
