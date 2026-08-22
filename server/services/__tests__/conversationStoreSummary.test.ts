import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { listConversations, recordIncomingMessage } from '../conversationStore';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
let fake: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  fake = createFakeSupabase();
  initDb(fake);
});

describe('resumo da lista de conversas', () => {
  it('transporta apenas a última mensagem e mantém a contagem de não lidas', async () => {
    await recordIncomingMessage(TENANT_ID, '595981111111', 'Cliente', {
      type: 'text',
      text: 'primeira mensagem',
      timestamp: '10:00',
    });
    const firstMessage = fake.__tables.messages[0];
    firstMessage.created_at = '2099-01-01T10:00:00.000Z';

    await recordIncomingMessage(TENANT_ID, '595981111111', 'Cliente', {
      type: 'text',
      text: 'última mensagem',
      timestamp: '10:01',
    });
    const secondMessage = fake.__tables.messages[1];
    secondMessage.created_at = '2099-01-01T10:01:00.000Z';

    const [conversation] = await listConversations(TENANT_ID);

    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.text).toBe('última mensagem');
    expect(conversation.lastMessageId).toBe(conversation.messages[0]?.id);
    expect(conversation.unreadCount).toBe(2);
  });
});
