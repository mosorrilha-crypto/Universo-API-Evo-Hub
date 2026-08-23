import { describe, expect, it } from 'vitest';
import { buildAgentContextPack, deriveContactMemoryPatch } from '../agentContextPack';
import type { ContactAgentMemory } from '../contactAgentMemoryStore';

const memory: ContactAgentMemory = {
  tenant_id: 'tenant-a',
  phone: '595981111111',
  preferred_language: 'es-PY',
  preferred_name: 'Ana',
  current_intent: 'faq',
  service_interest: 'pestañas/extensiones',
  objections: ['Quer saber duração antes de decidir.'],
  facts_confirmed: { preferredChannel: 'whatsapp' },
  open_loops: [{ kind: 'follow_up', summary: 'Aguardando escolha do serviço.', status: 'awaiting_customer' }],
  next_best_action: 'Aguardar escolha do cliente.',
  conversation_summary: 'Interesse: pestañas/extensiones.',
  updated_by: 'system',
  created_at: '2026-08-22T00:00:00.000Z',
  updated_at: '2026-08-22T00:00:00.000Z',
};

describe('Agent Context Pack', () => {
  it('expõe memória compacta e estado vivo no prompt sem colocar telefone ou nome nos fatos auditáveis', () => {
    const pack = buildAgentContextPack({
      memory,
      appointment: { paymentStatus: 'pending_verification' },
      escalation: { id: 'esc-1', kind: 'payment_proof', resolved: false },
    });

    expect(pack.promptSection).toContain('Contexto operacional do contato');
    expect(pack.promptSection).toContain('Idioma preferido registrado: es-PY');
    expect(pack.promptSection).toContain('comprovante em verificação humana');
    expect(pack.promptSection).toContain('Escalonamento humano aberto');
    expect(pack.selectedFacts).toMatchObject({
      memoryAvailable: true,
      paymentStatus: 'pending_verification',
      hasOpenEscalation: true,
    });
    expect(pack.selectedFacts).not.toHaveProperty('phone');
    expect(pack.selectedFacts).not.toHaveProperty('preferredName');
  });

  it('declara indisponibilidade de fonte viva de forma conservadora, nunca como ausência de agenda', () => {
    const pack = buildAgentContextPack({
      memory: null,
      appointmentAvailable: false,
      escalationAvailable: false,
    });

    expect(pack.promptSection).toContain('estado vivo indisponível neste turno');
    expect(pack.promptSection).not.toContain('não há registro ativo encontrado neste momento');
    expect(pack.selectedFacts).toMatchObject({ appointmentStateAvailable: false, escalationStateAvailable: false });
  });

  it('deriva somente memória operacional e mantém pagamento, agenda e escalonamento fora de facts_confirmed', () => {
    const patch = deriveContactMemoryPatch({
      existingMemory: memory,
      agent: 'agendamento',
      text: 'Quiero reservar mis pestañas.',
      needsHumanConfirmation: true,
      liveState: {
        appointment: { paymentStatus: 'pending_verification' },
        appointmentAvailable: true,
        escalation: null,
        escalationAvailable: true,
      },
    });

    expect(patch.currentIntent).toBe('agendamento');
    expect(patch.serviceInterest).toBe('pestañas/extensiones');
    expect(patch.openLoops).toEqual([
      { kind: 'payment', summary: 'Pagamento requer revisão humana.', status: 'awaiting_human' },
      { kind: 'agenda', summary: 'Agendamento exige confirmação humana.', status: 'awaiting_human' },
    ]);
    expect(patch.factsConfirmed).toBeUndefined();
    expect(patch.nextBestAction).toContain('revisão humana do pagamento');
  });
});
