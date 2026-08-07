/**
 * Etapa 2 do roadmap (achado numa auditoria externa ao script da Monique):
 * (1) nada impedia a IA de agendar "Retoque" diretamente — esse item só
 * deve ser decidido por Monique depois de avaliar o resultado, nunca por
 * pedido direto do cliente. (2) a pré-reserva era só uma promessa em texto
 * ("te dejo pre-reservado"), sem registrar nada real em nenhum lugar —
 * agora vira uma linha real em pre_reservations via a ferramenta
 * criar_pre_reserva.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const createCalendarEvent = vi.fn(async () => 'evt-novo');
const setAppointmentForPhone = vi.fn(async () => undefined);
const createPreReservation = vi.fn(async (_tenantId: string, input: any) => ({
  id: 'pre-1',
  status: 'pending' as const,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  ...input,
}));

let mockKb: { products: Array<{ name: string; price: string; bookable?: boolean; durationMinutes?: number }> } | null = null;

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent,
  rescheduleCalendarEvent: vi.fn(async () => undefined),
  cancelCalendarEvent: vi.fn(async () => undefined),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => null),
  setAppointmentForPhone,
  clearAppointmentForPhone: vi.fn(async () => undefined),
}));
vi.mock('../conversationStore', () => ({
  getConversationCtwaClid: vi.fn(async () => null),
  recordOutgoingMessage: vi.fn(async () => ({}) as any),
}));
vi.mock('../knowledgeBaseStore', async () => {
  const actual = await vi.importActual<typeof import('../knowledgeBaseStore')>('../knowledgeBaseStore');
  return {
    ...actual,
    getKnowledgeBase: vi.fn(async () => mockKb),
  };
});
vi.mock('../preReservationStore', () => ({ createPreReservation }));

const { generateAutoReplyForText } = await import('../autoReply');

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

describe('criar_agendamento recusa serviço não-agendável (bookable:false)', () => {
  it('não cria o evento quando o serviço pedido é "Retoque" (bookable:false no catálogo)', async () => {
    mockKb = { products: [{ name: 'Retoque', price: 'Gs 150.000', bookable: false }] };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_agendamento',
      args: { titulo: 'Retoque', data_hora_inicio: '2026-08-10T10:00:00', data_hora_fim: '2026-08-10T10:30:00' },
    });

    await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar um retoque amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(setAppointmentForPhone).not.toHaveBeenCalled();
  });

  it('cria normalmente um serviço sem bookable:false', async () => {
    mockKb = { products: [{ name: 'Microlips', price: 'Gs 500.000', durationMinutes: 120 }] };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_agendamento',
      args: { titulo: 'Microlips', data_hora_inicio: '2026-08-10T10:00:00', data_hora_fim: '2026-08-10T12:00:00' },
    });

    await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(setAppointmentForPhone).toHaveBeenCalledTimes(1);
  });
});

describe('criar_pre_reserva registra um estado real (Etapa 1 + Etapa 2)', () => {
  it('chama createPreReservation com telefone/serviço/data combinada e o messageId como idempotência', async () => {
    mockKb = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    createPreReservation.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_pre_reserva',
      args: { servico: 'Microlips', data_combinada: '2026-08-15' },
    });

    await generateAutoReplyForText(
      'tenant-a', ai, 'te transfiro a seña na sexta', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, 'wamid.ABC123'
    );

    expect(createPreReservation).toHaveBeenCalledTimes(1);
    expect(createPreReservation).toHaveBeenCalledWith('tenant-a', {
      phone: '595981234567',
      contactName: 'Cliente',
      serviceName: 'Microlips',
      committedDate: '2026-08-15',
      waMessageId: 'wamid.ABC123',
    });
  });

  it('não registra (e não promete) pré-reserva quando falta o messageId', async () => {
    mockKb = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    createPreReservation.mockClear();

    const ai = makeFakeAiSingleTool({
      name: 'criar_pre_reserva',
      args: { servico: 'Microlips', data_combinada: '2026-08-15' },
    });

    await generateAutoReplyForText(
      'tenant-a', ai, 'te transfiro a seña na sexta', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
      // sem messageId
    );

    expect(createPreReservation).not.toHaveBeenCalled();
  });
});
