import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { getContactAgentMemory, normalizeMemoryFacts, normalizeOperatorContactMemoryPatch, updateContactAgentMemoryByOperator, upsertContactAgentMemory } from '../contactAgentMemoryStore';
import { listAgentTurnTraces, recordAgentTurnTrace, updateAgentTurnTraceOutcome } from '../agentTurnTraceStore';
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

  it('aceita apenas a allowlist de correção humana, substitui objeções e preserva estados vivos', async () => {
    await upsertContactAgentMemory({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: {
        preferredName: 'Nome anterior',
        objections: ['Objeção antiga'],
        factsConfirmed: { preferredTone: 'direto' },
        openLoops: [{ kind: 'payment', summary: 'Comprovante aguardando verificação.', status: 'awaiting_human' }],
        conversationSummary: 'Resumo do sistema.',
      },
    });

    const updated = await updateContactAgentMemoryByOperator({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: { preferredName: 'Ana corrigida', objections: ['Perguntou sobre duração'], nextBestAction: 'Responder a dúvida antes de avançar.' },
    });

    expect(updated.preferred_name).toBe('Ana corrigida');
    expect(updated.objections).toEqual(['Perguntou sobre duração']);
    expect(updated.updated_by).toBe('operator');
    expect(updated.open_loops).toEqual([{ kind: 'payment', summary: 'Comprovante aguardando verificação.', status: 'awaiting_human' }]);
    expect(updated.facts_confirmed).toEqual({ preferredTone: 'direto' });
    expect(updated.conversation_summary).toBe('Resumo do sistema.');
    expect(() => normalizeOperatorContactMemoryPatch({ paymentStatus: 'verified' })).toThrow('Campos não permitidos');
    expect(() => normalizeOperatorContactMemoryPatch({ openLoops: [] })).toThrow('Campos não permitidos');
    expect(() => normalizeOperatorContactMemoryPatch({ preferredName: 123 })).toThrow('deve ser texto ou nulo');
  });

  // TASK-0375 (pedido direto): "Observações" na Ficha do Contato é o mesmo
  // `conversation_summary` da Ficha IA — liberado pra edição humana nos dois
  // lugares (é só um resumo textual solto, não um estado vivo).
  it('permite operador corrigir conversationSummary sem afetar os demais campos', async () => {
    await upsertContactAgentMemory({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: { preferredName: 'Ana', serviceInterest: 'Lash Lift', conversationSummary: 'Resumo gerado pela IA.' },
    });

    const updated = await updateContactAgentMemoryByOperator({
      tenantId: TENANT_A,
      phone: PHONE,
      patch: { conversationSummary: 'Cliente prefere atendimento à tarde.' },
    });

    expect(updated.conversation_summary).toBe('Cliente prefere atendimento à tarde.');
    // Campos não incluídos no patch permanecem intactos.
    expect(updated.preferred_name).toBe('Ana');
    expect(updated.service_interest).toBe('Lash Lift');
    expect(updated.updated_by).toBe('operator');
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

  /**
   * TASK-0444 (achado real durante a auditoria de rastreabilidade, corrigido
   * depois de uma primeira leitura incompleta): `message_id` usava a mesma
   * sanitização de texto livre dos outros campos, que descarta qualquer
   * valor contendo "wamid." OU uma sequência de 8+ dígitos seguidos (padrão
   * pra pegar telefone). A primeira verificação olhou só o formato "wamid."
   * (canal Meta) — mas a Monique, tenant real usado nesta auditoria, usa o
   * canal Evolution como principal, não Meta. Testado depois com os dois
   * formatos reais: o ID hexadecimal do Evolution também bate no filtro
   * (tem uma sequência de 8 dígitos consecutivos, ex: "25221676" dentro de
   * "AC517A86E4A25221676BD4DDF5004169") e o ID interno que o próprio código
   * gera pra mensagens enviadas (`wa-{timestamp}-{sufixo}`) também bate (o
   * timestamp é só dígitos) — confirmando que o bug não era específico do
   * Meta, quebrava a correlação por mensagem nos dois canais.
   */
  it.each([
    ['formato Meta ("wamid.…")', 'wamid.HBgLNTk1OTgxMTExMTEVAgASGBQzQUIxOTQ='],
    ['formato hexadecimal do Evolution', 'AC517A86E4A25221676BD4DDF5004169'],
    ['id interno gerado pro envio (wa-{timestamp}-{sufixo})', 'wa-1787166819637-6xf00i'],
  ])('persiste message_id no %s, que antes era descartado por engano', async (_label, messageId) => {
    const trace = await recordAgentTurnTrace({
      tenantId: TENANT_A,
      phone: PHONE,
      messageId,
      routerDecision: 'faq',
      contextPackVersion: 'contact-context-v1',
      needsHumanConfirmation: false,
    });

    expect(trace.message_id).toBe(messageId);
  });

  describe('updateAgentTurnTraceOutcome — status de revisão/envio (TASK-0444)', () => {
    it('atualiza review_status/final_send_status/output_message_ids sem alterar os demais campos do trace', async () => {
      await recordAgentTurnTrace({
        tenantId: TENANT_A,
        phone: PHONE,
        messageId: 'wamid.msg-1',
        routerDecision: 'faq',
        contextPackVersion: 'contact-context-v1',
        needsHumanConfirmation: false,
        outcome: 'reply_ready',
      });

      await updateAgentTurnTraceOutcome({
        tenantId: TENANT_A,
        messageId: 'wamid.msg-1',
        reviewStatus: 'approved_with_correction',
        finalSendStatus: 'sent',
        outputMessageIds: ['wa-1-abc', 'wa-2-def'],
      });

      const [trace] = await listAgentTurnTraces(TENANT_A, PHONE);
      expect(trace.review_status).toBe('approved_with_correction');
      expect(trace.final_send_status).toBe('sent');
      expect(trace.output_message_ids).toEqual(['wa-1-abc', 'wa-2-def']);
      // Campos gravados no insert original continuam intactos.
      expect(trace.router_decision).toBe('faq');
      expect(trace.outcome).toBe('reply_ready');
    });

    it('nunca atualiza o trace de outro tenant com o mesmo message_id', async () => {
      await recordAgentTurnTrace({
        tenantId: TENANT_A,
        phone: PHONE,
        messageId: 'wamid.shared',
        routerDecision: 'faq',
        contextPackVersion: 'contact-context-v1',
        needsHumanConfirmation: false,
      });
      await recordAgentTurnTrace({
        tenantId: TENANT_B,
        phone: PHONE,
        messageId: 'wamid.shared',
        routerDecision: 'faq',
        contextPackVersion: 'contact-context-v1',
        needsHumanConfirmation: false,
      });

      await updateAgentTurnTraceOutcome({ tenantId: TENANT_A, messageId: 'wamid.shared', reviewStatus: 'blocked', finalSendStatus: 'not_sent_blocked' });

      const [traceA] = await listAgentTurnTraces(TENANT_A, PHONE);
      const [traceB] = await listAgentTurnTraces(TENANT_B, PHONE);
      expect(traceA.review_status).toBe('blocked');
      expect(traceB.review_status).toBeUndefined();
    });

    it('não lança quando não existe trace correspondente (ex: insert original falhou) nem quando messageId está vazio', async () => {
      await expect(updateAgentTurnTraceOutcome({ tenantId: TENANT_A, messageId: 'sem-trace-nenhum', reviewStatus: 'blocked' })).resolves.toBeUndefined();
      await expect(updateAgentTurnTraceOutcome({ tenantId: TENANT_A, messageId: '', reviewStatus: 'blocked' })).resolves.toBeUndefined();
    });
  });
});
