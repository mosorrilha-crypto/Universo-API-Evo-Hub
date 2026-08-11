/**
 * Refinamento de humanização (pesquisa de mercado sobre chatbots que
 * "esquecem" o nome do cliente): quando a cliente diz o próprio nome na
 * conversa (não veio do perfil do WhatsApp), o nome precisa ficar salvo de
 * verdade — não só flutuando na janela de histórico recente, que teria
 * feito o agente "esquecer" assim que a mensagem saísse das últimas 10.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, getConversation, setConversationNameIfMissing } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('setConversationNameIfMissing', () => {
  it('grava o nome capturado quando a conversa ainda não tinha nenhum', async () => {
    // Lead sem nome de perfil no WhatsApp (mensagem sem `name`).
    await recordIncomingMessage(TENANT_A, '595981111111', undefined, { type: 'text', text: 'Soy Camila, quería consultar', timestamp: '10:00' });

    await setConversationNameIfMissing(TENANT_A, '595981111111', 'Camila');

    const conv = await getConversation(TENANT_A, '595981111111');
    expect(conv?.name).toBe('Camila');
  });

  it('NUNCA sobrescreve um nome já existente (ex: nome de perfil real do WhatsApp)', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Camila (WhatsApp)', { type: 'text', text: 'oi', timestamp: '10:00' });

    await setConversationNameIfMissing(TENANT_A, '595981111111', 'Outro Nome Qualquer');

    const conv = await getConversation(TENANT_A, '595981111111');
    expect(conv?.name).toBe('Camila (WhatsApp)');
  });
});
