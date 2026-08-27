/**
 * Achado real em produção (18/08/2026): consultar_disponibilidade_semana já
 * usava a duração real cadastrada no catálogo pra listar horários livres,
 * mas nada garantia que criar_agendamento/remarcar_agendamento criassem o
 * evento de verdade com essa MESMA duração — o modelo decide
 * data_hora_fim/nova_data_hora_fim livremente, e um erro de aritmética dele
 * (ex: agendar só 1h de um serviço de 3h) deixava o evento real no Google
 * Calendar mais curto que o serviço de verdade, abrindo o resto do horário
 * pra outro cliente com o MESMO profissional. resolveAuthoritativeEndIso
 * (autoReply.ts) agora recalcula o fim a partir da duração cadastrada,
 * ignorando o que o modelo mandou.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const createCalendarEvent = vi.fn(async () => 'evt-novo');
const rescheduleCalendarEvent = vi.fn(async () => undefined);
const setAppointmentForPhone = vi.fn(async () => undefined);
const createAppointmentHold = vi.fn(async () => undefined);
let mockAppointment: { eventId?: string; summary: string; startIso: string; endIso: string; paymentStatus?: string } | null = null;
let mockKb: { products: Array<{ name: string; price: string; durationMinutes?: number }> } | null = null;

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent,
  rescheduleCalendarEvent,
  cancelCalendarEvent: vi.fn(async () => undefined),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => mockAppointment),
  setAppointmentForPhone,
  clearAppointmentForPhone: vi.fn(async () => undefined),
  createAppointmentHold,
  findOverlappingHold: vi.fn(async () => undefined),
}));
vi.mock('../conversationStore', () => ({
  getConversationCtwaClid: vi.fn(async () => null),
  recordOutgoingMessage: vi.fn(async () => ({}) as any),
}));
vi.mock('../knowledgeBaseStore', async () => {
  const actual = await vi.importActual<typeof import('../knowledgeBaseStore')>('../knowledgeBaseStore');
  return {
    ...actual, // findProductDurationMinutes/isNonBookableProduct REAIS — é isso que este arquivo testa
    getKnowledgeBase: vi.fn(async () => mockKb),
    getRuntimeKnowledgeBase: vi.fn(async () => ({ knowledgeBase: mockKb, source: 'published_documents' as const })),
  };
});

const { executeApprovedCalendarActions, generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAiSingleTool(call: { name: string; args: Record<string, unknown> }): GoogleGenAI {
  let toolCallCount = 0;
  return {
    models: {
      generateContent: async (req: any) => {
        if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
        }
        if (req.config?.tools) {
          toolCallCount++;
          if (toolCallCount === 1) {
            return { functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] } as any;
          }
          return { functionCalls: [] } as any;
        }
        return { text: JSON.stringify({ phase: 'fechamento', bubbles: ['Ok!'], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('criar_agendamento/remarcar_agendamento ignoram o data_hora_fim errado do modelo e usam a duração real do catálogo', () => {
  it('corrige um data_hora_fim curto demais pro serviço de 3h (Combo Triple) na criação', async () => {
    mockAppointment = null;
    mockKb = { products: [{ name: 'Combo Triple', price: 'Gs 600.000', durationMinutes: 180 }] };
    createCalendarEvent.mockClear();
    createAppointmentHold.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_agendamento',
      // Modelo errou a conta: pediu só 30min pra um serviço de 180min.
      args: { titulo: 'Combo Triple', data_hora_inicio: '2026-08-10T14:00:00', data_hora_fim: '2026-08-10T14:30:00' },
    });

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar o combo triple às 14h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );
    await executeApprovedCalendarActions('tenant-a', '595981234567', CALENDAR_CONFIG, result?.deferredCalendarActions, 'Cliente');

    // Issue #289: não cria mais o evento real na hora — a RESERVA tem que
    // cobrir as 3h inteiras (14:00–17:00), não os 30min que o modelo mandou.
    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(createAppointmentHold).toHaveBeenCalledWith(
      'tenant-a', '595981234567',
      expect.objectContaining({ summary: 'Combo Triple', startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T17:00:00' })
    );
  });

  it('corrige um nova_data_hora_fim curto demais na remarcação, usando a duração do serviço já agendado', async () => {
    mockAppointment = { eventId: 'evt-existente', summary: 'Combo Triple', startIso: '2026-08-09T10:00:00', endIso: '2026-08-09T13:00:00' };
    mockKb = { products: [{ name: 'Combo Triple', price: 'Gs 600.000', durationMinutes: 180 }] };
    rescheduleCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'remarcar_agendamento',
      args: { nova_data_hora_inicio: '2026-08-11T09:00:00', nova_data_hora_fim: '2026-08-11T09:45:00' },
    });

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'posso remarcar pra amanhã 9h?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );
    await executeApprovedCalendarActions('tenant-a', '595981234567', CALENDAR_CONFIG, result?.deferredCalendarActions, 'Cliente');

    expect(rescheduleCalendarEvent).toHaveBeenCalledWith('tenant-a', CALENDAR_CONFIG, 'evt-existente', '2026-08-11T09:00:00', '2026-08-11T12:00:00', expect.any(String));
    expect(setAppointmentForPhone).toHaveBeenCalledWith(
      'tenant-a', '595981234567',
      expect.objectContaining({ startIso: '2026-08-11T09:00:00', endIso: '2026-08-11T12:00:00' })
    );
  });

  it('usa a duração padrão conservadora (1h) quando o serviço não está no catálogo', async () => {
    mockAppointment = null;
    mockKb = { products: [] };
    createCalendarEvent.mockClear();
    createAppointmentHold.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_agendamento',
      args: { titulo: 'Serviço Novo Sem Cadastro', data_hora_inicio: '2026-08-10T14:00:00', data_hora_fim: '2026-08-10T14:05:00' },
    });

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );
    await executeApprovedCalendarActions('tenant-a', '595981234567', CALENDAR_CONFIG, result?.deferredCalendarActions, 'Cliente');

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(createAppointmentHold).toHaveBeenCalledWith(
      'tenant-a', '595981234567',
      expect.objectContaining({ summary: 'Serviço Novo Sem Cadastro', startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T15:00:00' })
    );
  });
});
