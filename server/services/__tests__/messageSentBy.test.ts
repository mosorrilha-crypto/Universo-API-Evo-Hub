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
import { recordIncomingMessage, recordOutgoingMessage, forwardMessage, getConversationMessagesPage } from '../conversationStore';

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

describe('messages.operator_name (TASK-0370 — identificar qual operador específico escreveu)', () => {
  it('grava operator_name quando sentBy=operator e o nome foi informado', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'operator', undefined, undefined, undefined, 'Monique');
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].operator_name).toBe('Monique');
  });

  it('nunca grava operator_name em mensagem da IA, mesmo se um nome for passado por engano', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'ai', undefined, undefined, undefined, 'Monique');
    const rows = supabase.__tables.messages;
    expect(rows[0].operator_name).toBeNull();
  });

  it('sem nome informado, operator_name fica null (mensagens antigas/sem identificação seguem funcionando, painel cai no rótulo genérico)', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'operator');
    const rows = supabase.__tables.messages;
    expect(rows[0].operator_name).toBeNull();
  });

  it('a página de mensagens (usada pelo painel pra buscar mensagens novas) devolve operatorName pro painel identificar quem escreveu', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'Qual é o teu nome?', timestamp: '10:00' }, 'operator', undefined, undefined, undefined, 'Lucas');
    const page = await getConversationMessagesPage(TENANT_A, '595981111111');
    expect(page.messages[0].operatorName).toBe('Lucas');
  });
});
