/**
 * Achado real reportado pelo Lucas comparando com o WhatsApp Web oficial: o
 * chip "Não lidos" e o badge numérico na lista de conversas nunca refletiam
 * mensagens de verdade — usavam o status de transcrição do lead (pending/
 * processing/transcribed/error) como proxy, que pra conversas reais sempre
 * chega como 'transcribed' (nunca 'pending'). Estes testes cobrem a lógica
 * real de contagem (countUnreadMessages) e o marcar-como-lido
 * (markConversationRead) que substituem esse proxy — ver
 * server/services/conversationStore.ts e supabase/migrations/0007_conversation_unread_tracking.sql.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { countUnreadMessages, markConversationRead } from '../conversationStore';

describe('countUnreadMessages', () => {
  it('conta só mensagens do lead criadas depois de lastReadAt', () => {
    const messages = [
      { sender: 'lead' as const, created_at: '2026-08-01T10:00:00.000Z' }, // antes de lastReadAt — lida
      { sender: 'agent' as const, created_at: '2026-08-01T11:00:00.000Z' }, // depois, mas é do agente — não conta
      { sender: 'lead' as const, created_at: '2026-08-01T12:00:00.000Z' }, // depois de lastReadAt e do lead — não lida
      { sender: 'lead' as const, created_at: '2026-08-01T13:00:00.000Z' }, // idem
    ];
    expect(countUnreadMessages(messages, '2026-08-01T10:30:00.000Z')).toBe(2);
  });

  it('retorna 0 quando não há mensagens ou nenhuma é do lead depois de lastReadAt', () => {
    expect(countUnreadMessages([], '2026-08-01T10:00:00.000Z')).toBe(0);
    expect(
      countUnreadMessages(
        [{ sender: 'agent', created_at: '2026-08-01T12:00:00.000Z' }],
        '2026-08-01T10:00:00.000Z'
      )
    ).toBe(0);
  });
});

describe('markConversationRead', () => {
  beforeEach(() => {
    initDb(createFakeSupabase());
  });

  it('atualiza last_read_at só da conversa do tenant/telefone certo', async () => {
    const db = createFakeSupabase({
      conversations: [
        { id: 'conv-1', tenant_id: 'tenant-1', phone: '595981828280', last_read_at: '2000-01-01T00:00:00.000Z' },
        { id: 'conv-2', tenant_id: 'tenant-2', phone: '595981828280', last_read_at: '2000-01-01T00:00:00.000Z' },
      ],
    });
    initDb(db);

    const before = Date.now();
    await markConversationRead('tenant-1', '595981828280');

    const conv1 = db.__tables.conversations.find((c: any) => c.id === 'conv-1');
    const conv2 = db.__tables.conversations.find((c: any) => c.id === 'conv-2');
    expect(new Date(conv1.last_read_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(conv2.last_read_at).toBe('2000-01-01T00:00:00.000Z');
  });
});
