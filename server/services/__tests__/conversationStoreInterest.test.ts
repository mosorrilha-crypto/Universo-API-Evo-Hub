/**
 * TASK-0185 (parte 2) — coluna "Interesse" do backup em Google Sheets:
 * diferente de setConversationNameIfMissing, updateConversationInterest
 * SEMPRE sobrescreve com o valor mais recente (a cliente pode mudar de
 * ideia sobre qual serviço quer no meio da conversa).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, getConversation, updateConversationInterest } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('updateConversationInterest', () => {
  it('grava o serviço de interesse captado pelo especialista', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', undefined, { type: 'text', text: 'quiero microblading', timestamp: '10:00' });

    await updateConversationInterest(TENANT_A, '595981111111', 'Micropigmentación de Cejas');

    const conv = await getConversation(TENANT_A, '595981111111');
    expect(conv?.interest).toBe('Micropigmentación de Cejas');
  });

  it('SEMPRE sobrescreve com o valor mais recente (cliente mudou de ideia sobre o serviço)', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', undefined, { type: 'text', text: 'quiero cejas', timestamp: '10:00' });
    await updateConversationInterest(TENANT_A, '595981111111', 'Micropigmentación de Cejas');

    await updateConversationInterest(TENANT_A, '595981111111', 'Lash Lift');

    const conv = await getConversation(TENANT_A, '595981111111');
    expect(conv?.interest).toBe('Lash Lift');
  });
});
