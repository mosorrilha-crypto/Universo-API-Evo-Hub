import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { invalidateAllSystemInstructionCaches } from '../geminiSystemInstructionCache';

const getAppointmentForPhone = vi.fn(async () => undefined);
const loadAgentContextPack = vi.fn();
const buildAgentContextPack = vi.fn();
const deriveContactMemoryPatch = vi.fn(() => ({ currentIntent: 'faq', updatedBy: 'system' as const }));
const upsertContactAgentMemory = vi.fn(async () => ({}));
const recordAgentTurnTrace = vi.fn(async () => ({}));

const CONTEXT_PACK = {
  version: 'contact-context-v1',
  memory: null,
  liveState: { appointment: null, appointmentAvailable: true, escalation: null, escalationAvailable: true },
  selectedFacts: { memoryAvailable: true, serviceInterest: 'pestañas/extensiones' },
  promptSection: 'Contexto operacional do contato (dados compactos e auditáveis):\n- MARCADOR-CONTEXT-PACK',
};

vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone,
  setAppointmentForPhone: vi.fn(),
  clearAppointmentForPhone: vi.fn(),
  confirmPayment: vi.fn(),
  createAppointmentHold: vi.fn(),
  findOverlappingHold: vi.fn(),
}));
vi.mock('../agentContextPack', () => ({
  loadAgentContextPack,
  buildAgentContextPack,
  deriveContactMemoryPatch,
}));
vi.mock('../contactAgentMemoryStore', () => ({ upsertContactAgentMemory }));
vi.mock('../agentTurnTraceStore', () => ({ recordAgentTurnTrace }));

const { generateAutoReplyForText } = await import('../autoReply');

function makeFakeAi() {
  const calls: any[] = [];
  const ai = {
    models: {
      generateContent: async (request: any) => {
        calls.push(request);
        if (request.contents[0].text.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'faq' }) };
        }
        return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Claro, te explico.'], needsHumanConfirmation: false }) };
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, calls };
}

beforeEach(() => {
  invalidateAllSystemInstructionCaches();
  vi.clearAllMocks();
  getAppointmentForPhone.mockResolvedValue(undefined);
  loadAgentContextPack.mockResolvedValue({ contextPack: CONTEXT_PACK, issues: [] });
  buildAgentContextPack.mockImplementation((input: any) => ({
    ...CONTEXT_PACK,
    memory: input.memory,
    liveState: {
      appointment: input.appointment || null,
      appointmentAvailable: input.appointmentAvailable,
      escalation: input.escalation || null,
      escalationAvailable: input.escalationAvailable,
    },
  }));
});

describe('generateAutoReplyForText — Context Pack', () => {
  it('entrega o Context Pack compacto ao especialista e registra memória/trace após os gates', async () => {
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'Quiero saber el precio de las pestañas.', undefined, undefined, undefined,
      '595981111111'
    );

    expect(result?.bubbles).toEqual(['Claro, te explico.']);
    expect(calls[1].contents[0].text).toContain('MARCADOR-CONTEXT-PACK');
    expect(upsertContactAgentMemory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      phone: '595981111111',
    }));
    expect(recordAgentTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      routerDecision: 'faq',
      needsHumanConfirmation: false,
      contextPackVersion: 'contact-context-v1',
      selectedFacts: CONTEXT_PACK.selectedFacts,
    }));
  });

  it('preserva a resposta quando o carregamento do Context Pack falha', async () => {
    loadAgentContextPack.mockRejectedValueOnce(new Error('tabela ainda não aplicada'));
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'Quiero saber el precio.', undefined, undefined, undefined,
      '595981111111'
    );

    expect(result).not.toBeNull();
    expect(calls[1].contents[0].text).not.toContain('MARCADOR-CONTEXT-PACK');
    expect(upsertContactAgentMemory).not.toHaveBeenCalled();
    expect(recordAgentTurnTrace).not.toHaveBeenCalled();
  });
});
