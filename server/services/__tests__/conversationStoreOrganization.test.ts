/**
 * Organização de conversas no painel — arquivar, fixar, silenciar, marcar
 * como não lida manualmente (updateConversationState/listConversations em
 * conversationStore.ts). Segue o padrão de tenantIsolation.test.ts: fake
 * Supabase em memória via initDb(createFakeSupabase()).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, listConversations, updateConversationState } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('organização de conversas — arquivar, fixar, silenciar, não lida', () => {
  it('isolamento: tenant B não consegue atualizar o estado de uma conversa do tenant A', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });

    const result = await updateConversationState(TENANT_B, '595981111111', { pinned: true });
    expect(result).toBeUndefined();

    const [convA] = await listConversations(TENANT_A);
    expect(convA.pinnedAt).toBeUndefined();
  });

  it('conversa fixada aparece antes das outras, mesmo sendo a mais antiga', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Antiga', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_A, '595982222222', 'Recente', { type: 'text', text: 'oi', timestamp: '10:05' });
    await updateConversationState(TENANT_A, '595981111111', { pinned: true });

    const list = await listConversations(TENANT_A);
    expect(list.map((c) => c.phone)).toEqual(['595981111111', '595982222222']);
  });

  it('conversa arquivada não aparece em listConversations por padrão, mas aparece com includeArchived', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await updateConversationState(TENANT_A, '595981111111', { archived: true });

    const defaultList = await listConversations(TENANT_A);
    expect(defaultList).toHaveLength(0);

    const withArchived = await listConversations(TENANT_A, { includeArchived: true });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0].archivedAt).toBeTruthy();
  });

  it('desarquivar (archived: false) faz a conversa voltar pra lista padrão', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await updateConversationState(TENANT_A, '595981111111', { archived: true });
    await updateConversationState(TENANT_A, '595981111111', { archived: false });

    const list = await listConversations(TENANT_A);
    expect(list).toHaveLength(1);
    expect(list[0].archivedAt).toBeUndefined();
  });

  it('silenciar e marcar como não lida manualmente persistem e podem ser revertidos', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await updateConversationState(TENANT_A, '595981111111', { muted: true, unread: true });

    let [conv] = await listConversations(TENANT_A);
    expect(conv.muted).toBe(true);
    expect(conv.manuallyUnread).toBe(true);

    await updateConversationState(TENANT_A, '595981111111', { muted: false, unread: false });
    [conv] = await listConversations(TENANT_A);
    expect(conv.muted).toBe(false);
    expect(conv.manuallyUnread).toBe(false);
  });

  it('updateConversationState retorna undefined pra conversa inexistente', async () => {
    const result = await updateConversationState(TENANT_A, '000000000', { pinned: true });
    expect(result).toBeUndefined();
  });
});
