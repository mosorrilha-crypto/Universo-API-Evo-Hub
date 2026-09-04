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

  it('inclui há quanto tempo e o motivo da escalação aberta, com instrução explícita de não reabrir o mesmo assunto', () => {
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const pack = buildAgentContextPack({
      memory: null,
      escalation: {
        id: 'esc-2',
        kind: 'general',
        resolved: false,
        reason: 'Revisor pré-envio bloqueou a resposta automática: nome não confirmado antes de avançar pra agenda.',
        createdAt: fortyMinutesAgo,
      },
    });

    expect(pack.promptSection).toContain('há 40 min');
    expect(pack.promptSection).toContain('motivo: "Revisor pré-envio bloqueou a resposta automática');
    expect(pack.promptSection).toContain('NÃO reabra nem repita sozinho o mesmo assunto');
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

  // TASK-0246: inferServiceInterest passou a casar contra o catálogo real
  // do tenant em vez de uma lista fixa de 3 categorias de estética
  // (achado real: nunca detectava nada pra um tenant de outro segmento).
  it('detecta o interesse pela categoria do catálogo real do tenant, mesmo fora do vocabulário de estética', () => {
    const patch = deriveContactMemoryPatch({
      existingMemory: null,
      agent: 'triagem',
      text: 'Vocês fazem limpeza de piscina residencial?',
      needsHumanConfirmation: false,
      liveState: { appointment: null, appointmentAvailable: true, escalation: null, escalationAvailable: true },
      knowledgeBase: {
        products: [
          { name: 'Manutenção mensal', price: 'sob consulta', category: 'Limpeza de piscina' },
          { name: 'Troca de areia do filtro', price: 'sob consulta' },
        ],
      } as any,
    });

    expect(patch.serviceInterest).toBe('Limpeza de piscina');
  });

  it('detecta o interesse pelo nome/apelido do produto quando não há categoria batendo', () => {
    const patch = deriveContactMemoryPatch({
      existingMemory: null,
      agent: 'triagem',
      text: 'Queria saber o valor do Combo Full Face',
      needsHumanConfirmation: false,
      liveState: { appointment: null, appointmentAvailable: true, escalation: null, escalationAvailable: true },
      knowledgeBase: {
        products: [
          { name: 'Design de sobrancelhas premium', aliases: ['Combo Full Face'], price: 'sob consulta' },
        ],
      } as any,
    });

    expect(patch.serviceInterest).toBe('Design de sobrancelhas premium');
  });

  it('ignora produto pausado (active: false) na inferência de interesse', () => {
    const patch = deriveContactMemoryPatch({
      existingMemory: null,
      agent: 'triagem',
      text: 'Vocês fazem retoque?',
      needsHumanConfirmation: false,
      liveState: { appointment: null, appointmentAvailable: true, escalation: null, escalationAvailable: true },
      knowledgeBase: {
        products: [
          { name: 'Retoque', price: 'sob consulta', category: 'Retoque', active: false },
        ],
      } as any,
    });

    expect(patch.serviceInterest).toBeUndefined();
  });

  it('cai no fallback legado de estética quando o tenant não tem catálogo cadastrado', () => {
    const patch = deriveContactMemoryPatch({
      existingMemory: null,
      agent: 'triagem',
      text: 'Quiero preguntar por mis pestañas.',
      needsHumanConfirmation: false,
      liveState: { appointment: null, appointmentAvailable: true, escalation: null, escalationAvailable: true },
      knowledgeBase: null,
    });

    expect(patch.serviceInterest).toBe('pestañas/extensiones');
  });
});
