/**
 * TASK-0260 — achado real: excluir a conversa apagava `conversations`/
 * `messages` (cascade via FK), mas deixava `contact_agent_memory` intocada
 * (tabela à parte, chaveada só por tenant_id+phone). O dono do produto
 * reportou que "excluir conversa" não deixava um teste limpo "sem
 * contexto" — a causa real é essa memória sobrevivendo à exclusão e sendo
 * recarregada por `loadAgentContextPack` no próximo turno do mesmo telefone.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, deleteConversation } from '../conversationStore';
import { upsertContactAgentMemory, getContactAgentMemory } from '../contactAgentMemoryStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('deleteConversation — limpeza da memória do agente junto com a conversa', () => {
  it('apaga a memória operacional do contato (contact_agent_memory) junto com a conversa', async () => {
    const phone = '595981111111';
    await recordIncomingMessage(TENANT_A, phone, 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await upsertContactAgentMemory({
      tenantId: TENANT_A,
      phone,
      patch: { currentIntent: 'agendamento', serviceInterest: 'Limpeza de pele', conversationSummary: 'Quer marcar horário' },
    });

    expect(await getContactAgentMemory(TENANT_A, phone)).not.toBeNull();

    const deleted = await deleteConversation(TENANT_A, phone);
    expect(deleted).toBe(true);

    expect(await getContactAgentMemory(TENANT_A, phone)).toBeNull();
  });

  it('não apaga a memória de outro tenant com o mesmo telefone (isolamento)', async () => {
    const phone = '595982222222';
    await recordIncomingMessage(TENANT_A, phone, 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_B, phone, 'Cliente B', { type: 'text', text: 'oi', timestamp: '10:00' });
    await upsertContactAgentMemory({ tenantId: TENANT_A, phone, patch: { currentIntent: 'agendamento' } });
    await upsertContactAgentMemory({ tenantId: TENANT_B, phone, patch: { currentIntent: 'faq' } });

    await deleteConversation(TENANT_A, phone);

    expect(await getContactAgentMemory(TENANT_A, phone)).toBeNull();
    expect(await getContactAgentMemory(TENANT_B, phone)).not.toBeNull();
  });

  it('não quebra quando o contato não tinha nenhuma memória salva', async () => {
    const phone = '595983333333';
    await recordIncomingMessage(TENANT_A, phone, 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });

    await expect(deleteConversation(TENANT_A, phone)).resolves.toBe(true);
  });
});
