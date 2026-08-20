/**
 * Pub/sub em memória usado pela rota SSE /api/conversations/stream (ver
 * conversations.ts) — substitui o polling de 8s do frontend.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, updateConversationState, reactToMessage } from '../conversationStore';
import { subscribeTenant, emitConversationUpdated, emitAiReplyStatus } from '../conversationEvents';

let supabase: ReturnType<typeof createFakeSupabase>;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('conversationEvents (pub/sub em memória)', () => {
  it('avisa quem assina o tenant certo', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    emitConversationUpdated(TENANT_A, '595981111111');
    expect(listener).toHaveBeenCalledWith('595981111111');
    unsubscribe();
  });

  it('isolamento: assinante do tenant B não recebe evento do tenant A', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeTenant(TENANT_A, listenerA);
    subscribeTenant(TENANT_B, listenerB);
    emitConversationUpdated(TENANT_A, '595981111111');
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });

  it('unsubscribe para de receber eventos', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    unsubscribe();
    emitConversationUpdated(TENANT_A, '595981111111');
    expect(listener).not.toHaveBeenCalled();
  });

  it('recordIncomingMessage dispara o evento com o telefone certo', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    await recordIncomingMessage(TENANT_A, '595982222222', 'Cliente', { type: 'text', text: 'oi', timestamp: '10:00' });
    expect(listener).toHaveBeenCalledWith('595982222222');
    unsubscribe();
  });

  it('updateConversationState (ex: arquivar) dispara o evento', async () => {
    await recordIncomingMessage(TENANT_A, '595983333333', 'Cliente', { type: 'text', text: 'oi', timestamp: '10:00' });
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    await updateConversationState(TENANT_A, '595983333333', { archived: true });
    expect(listener).toHaveBeenCalledWith('595983333333');
    unsubscribe();
  });

  it('emitAiReplyStatus manda o telefone e o status junto (pedido real, 20/08/2026: aviso de "IA formulando resposta" no painel)', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    emitAiReplyStatus(TENANT_A, '595981111111', 'generating');
    expect(listener).toHaveBeenCalledWith('595981111111', { aiReplyStatus: 'generating' });
    unsubscribe();
  });

  it('reactToMessage (só tem o id da mensagem) resolve o telefone certo e dispara o evento', async () => {
    await recordIncomingMessage(TENANT_A, '595984444444', 'Cliente', { type: 'text', text: 'oi', timestamp: '10:00' });
    const messageId = supabase.__tables.messages.find((m: any) => m.tenant_id === TENANT_A)!.id;
    const listener = vi.fn();
    const unsubscribe = subscribeTenant(TENANT_A, listener);
    await reactToMessage(TENANT_A, messageId, '👍', 'agent');
    expect(listener).toHaveBeenCalledWith('595984444444');
    unsubscribe();
  });
});
