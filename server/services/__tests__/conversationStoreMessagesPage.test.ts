/**
 * TASK-0280 (achado real, 04/09/2026: "Carregando histórico completo" toda
 * vez que abre uma conversa, demora e atrapalha em rede fraca) —
 * getConversationMessagesPage substitui, só na abertura/rolagem do painel,
 * o antigo "busca a conversa inteira de uma vez" por páginas: as mais
 * recentes na abertura, mais antigas ao rolar pra cima (beforeTimestamp), e
 * só as novas quando a conversa já está aberta (afterTimestamp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { getConversationMessagesPage } from '../conversationStore';

function seedMessages(count: number, conversationId = 'conv-1', tenantId = 'tenant-1') {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${String(i).padStart(3, '0')}`,
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender: i % 2 === 0 ? 'lead' : 'agent',
    type: 'text',
    text: `mensagem ${i}`,
    created_at: `2026-09-01T00:${String(i).padStart(2, '0')}:00.000Z`,
  }));
}

describe('getConversationMessagesPage', () => {
  beforeEach(() => {
    initDb(createFakeSupabase());
  });

  it('conversa inexistente retorna vazio sem erro', async () => {
    initDb(createFakeSupabase({ conversations: [] }));
    const page = await getConversationMessagesPage('tenant-1', '595981111111', {});
    expect(page).toEqual({ messages: [], hasMore: false });
  });

  it('sem cursor, devolve as N mais recentes em ordem cronológica e marca hasMore', async () => {
    initDb(createFakeSupabase({
      conversations: [{ id: 'conv-1', tenant_id: 'tenant-1', phone: '595981111111' }],
      messages: seedMessages(10),
    }));

    const page = await getConversationMessagesPage('tenant-1', '595981111111', { limit: 3 });

    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.id)).toEqual(['msg-007', 'msg-008', 'msg-009']);
    // Ordem cronológica ascendente, pronta pra render direto na tela.
    expect(page.messages[0].timestamp < page.messages[2].timestamp).toBe(true);
  });

  it('quando o total cabe na página, hasMore fica falso', async () => {
    initDb(createFakeSupabase({
      conversations: [{ id: 'conv-1', tenant_id: 'tenant-1', phone: '595981111111' }],
      messages: seedMessages(3),
    }));

    const page = await getConversationMessagesPage('tenant-1', '595981111111', { limit: 30 });

    expect(page.hasMore).toBe(false);
    expect(page.messages.map((m) => m.id)).toEqual(['msg-000', 'msg-001', 'msg-002']);
  });

  it('beforeTimestamp busca a página anterior à mais antiga já carregada', async () => {
    initDb(createFakeSupabase({
      conversations: [{ id: 'conv-1', tenant_id: 'tenant-1', phone: '595981111111' }],
      messages: seedMessages(10),
    }));

    const firstPage = await getConversationMessagesPage('tenant-1', '595981111111', { limit: 3 });
    const oldestLoaded = firstPage.messages[0].timestamp;

    const olderPage = await getConversationMessagesPage('tenant-1', '595981111111', {
      limit: 3,
      beforeTimestamp: oldestLoaded,
    });

    expect(olderPage.messages.map((m) => m.id)).toEqual(['msg-004', 'msg-005', 'msg-006']);
    expect(olderPage.hasMore).toBe(true);
  });

  it('afterTimestamp busca só mensagens mais novas que o cursor, sem hasMore', async () => {
    initDb(createFakeSupabase({
      conversations: [{ id: 'conv-1', tenant_id: 'tenant-1', phone: '595981111111' }],
      messages: seedMessages(10),
    }));

    const page = await getConversationMessagesPage('tenant-1', '595981111111', {
      afterTimestamp: '2026-09-01T00:07:00.000Z',
    });

    expect(page.messages.map((m) => m.id)).toEqual(['msg-008', 'msg-009']);
    expect(page.hasMore).toBe(false);
  });

  it('nunca mistura mensagens de outro tenant/conversa', async () => {
    initDb(createFakeSupabase({
      conversations: [
        { id: 'conv-1', tenant_id: 'tenant-1', phone: '595981111111' },
        { id: 'conv-2', tenant_id: 'tenant-2', phone: '595981111111' },
      ],
      messages: [
        ...seedMessages(2, 'conv-1', 'tenant-1'),
        ...seedMessages(2, 'conv-2', 'tenant-2').map((m) => ({ ...m, id: `other-${m.id}` })),
      ],
    }));

    const page = await getConversationMessagesPage('tenant-1', '595981111111', { limit: 30 });

    expect(page.messages.map((m) => m.id)).toEqual(['msg-000', 'msg-001']);
  });
});
