/**
 * Issue #126 — messages.sent_by distingue resposta automática da IA de
 * mensagem digitada manualmente por um operador no painel. Cobre:
 * recordOutgoingMessage grava o valor certo pra cada origem; forwardMessage
 * sempre grava 'operator' (encaminhar é sempre uma ação manual no painel,
 * independente de quem gerou a mensagem original); mensagem de lead nunca
 * tem sent_by.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, recordOutgoingMessage, forwardMessage } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('messages.sent_by', () => {
  it('resposta automática da IA grava sent_by=ai', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'ai');
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_by).toBe('ai');
  });

  it('mensagem manual do operador grava sent_by=operator', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'operator');
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_by).toBe('operator');
  });

  it('mensagem de lead nunca tem sent_by', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente', { type: 'text', text: 'oi', timestamp: '10:00' });
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_by).toBeFalsy();
  });

  it('encaminhar mensagem sempre grava sent_by=operator, mesmo encaminhando uma resposta original da IA', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'resposta da IA', timestamp: '10:00' }, 'ai');
    const originalId = supabase.__tables.messages[0].id;

    await forwardMessage(TENANT_A, originalId, '595982222222');

    const forwarded = supabase.__tables.messages.find((m: any) => m.forwarded_from_message_id === originalId);
    expect(forwarded?.sent_by).toBe('operator');
  });
});
