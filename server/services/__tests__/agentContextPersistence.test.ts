import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { getContactAgentMemory, normalizeMemoryFacts, upsertContactAgentMemory } from '../contactAgentMemoryStore';
import { listAgentTurnTraces, recordAgentTurnTrace } from '../agentTurnTraceStore';
import { createFakeSupabase } from './fakeSupabase';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('memória de contexto e traces do agente', () => {
  it('mantém a memória do mesmo telefone isolada por tenant e faz merge de fatos explícitos', async () => {
    await upsertContactAgentMemory({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: {
        preferredLanguage: 'es-PY',
        serviceInterest: 'Extensiones de pestañas',
        factsConfirmed: { source: 'campaign', preferredChannel: 'whatsapp' },
        openLoops: [{ kind: 'follow_up', summary: 'Aguardando escolha do procedimento.', status: 'awaiting_customer' }],
      },
    });
    await upsertContactAgentMemory({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: { preferredName: 'Ana', factsConfirmed: { returningCustomer: true } },
    });
    await upsertContactAgentMemory({
      tenantId: TENANT_B,
      phone: PHONE,
      patch: { preferredName: 'Outra cliente', currentIntent: 'faq' },
    });

    const memoryA = await getContactAgentMemory(TENANT_A, PHONE);
    const memoryB = await getContactAgentMemory(TENANT_B, PHONE);

    expect(memoryA?.preferred_name).toBe('Ana');
    expect(memoryA?.preferred_language).toBe('es-PY');
    expect(memoryA?.facts_confirmed).toEqual({ source: 'campaign', preferredChannel: 'whatsapp', returningCustomer: true });
    expect(memoryA?.open_loops).toEqual([{ kind: 'follow_up', summary: 'Aguardando escolha do procedimento.', status: 'awaiting_customer' }]);
    expect(memoryB?.preferred_name).toBe('Outra cliente');
    expect(memoryB?.service_interest).toBeNull();
  });

  it('recusa estados vivos de pagamento, agenda e escalonamento na memória', () => {
    expect(normalizeMemoryFacts({
      preferredTone: 'direto',
      paymentStatus: 'approved',
      appointmentId: 'event-123',
      escalationId: 'esc-123',
    })).toEqual({ preferredTone: 'direto' });
  });

  it('redige payload sensível no trace e registra a flag de confirmação humana', async () => {
    const trace = await recordAgentTurnTrace({
      tenantId: TENANT_A,
      phone: PHONE,
      messageId: 'wamid.ABC123',
      routerDecision: 'agendamento',
      routerConfidence: 0.87,
      reasoningSummary: 'Pedido explícito de horário.',
      contextPackVersion: 'contact-context-v1',
      selectedFacts: {
        memoryAvailable: true,
        paymentStatus: 'pending_verification',
        phone: PHONE,
        receiptBase64: 'data:image/png;base64,super-secreto',
        messageText: 'meu texto original não deve persistir',
      },
      toolSummaries: ['Disponibilidade consultada para a data solicitada.', 'data:audio/ogg;base64,nao-persistir'],
      needsHumanConfirmation: true,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      latencyMs: 321,
      outcome: 'reply_ready',
    });

    expect(trace.needs_human_confirmation).toBe(true);
    expect(trace.selected_facts).toEqual({ memoryAvailable: true, paymentStatus: 'pending_verification' });
    expect(trace.tool_summaries).toEqual(['Disponibilidade consultada para a data solicitada.']);
  });

  it('faz upsert idempotente por mensagem e nunca lista traces de outro tenant', async () => {
    await recordAgentTurnTrace({
      tenantId: TENANT_A,
      phone: PHONE,
      messageId: 'message-1',
      routerDecision: 'faq',
      contextPackVersion: 'contact-context-v1',
      needsHumanConfirmation: false,
      outcome: 'reply_ready',
    });
    await recordAgentTurnTrace({
      tenantId: TENANT_A,
      phone: PHONE,
      messageId: 'message-1',
      routerDecision: 'agendamento',
      contextPackVersion: 'contact-context-v1',
      needsHumanConfirmation: true,
      outcome: 'human_confirmation_required',
    });
    await recordAgentTurnTrace({
      tenantId: TENANT_B,
      phone: PHONE,
      messageId: 'message-1',
      routerDecision: 'faq',
      contextPackVersion: 'contact-context-v1',
      needsHumanConfirmation: false,
      outcome: 'reply_ready',
    });

    const tracesA = await listAgentTurnTraces(TENANT_A, PHONE);
    const tracesB = await listAgentTurnTraces(TENANT_B, PHONE);

    expect(tracesA).toHaveLength(1);
    expect(tracesA[0].router_decision).toBe('agendamento');
    expect(tracesA[0].needs_human_confirmation).toBe(true);
    expect(tracesB).toHaveLength(1);
    expect(tracesB[0].router_decision).toBe('faq');
  });
});
