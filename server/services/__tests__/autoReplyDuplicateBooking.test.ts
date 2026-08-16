/**
 * Achado numa auditoria pós-lançamento: criar_agendamento não checava se o
 * contato já tinha um agendamento ativo — um segundo agendamento pro mesmo
 * telefone sobrescrevia silenciosamente o eventId rastreado do primeiro
 * (appointments é chaveada por tenant_id+phone), deixando o evento antigo
 * órfão na agenda real (continua ocupando o horário, mas remarcar/cancelar/
 * lembretes só enxergam o novo).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const createCalendarEvent = vi.fn(async () => 'evt-novo');
const setAppointmentForPhone = vi.fn(async () => undefined);
let mockAppointment: { eventId: string; summary: string; startIso: string; endIso: string; paymentStatus?: string } | null = null;

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent,
  rescheduleCalendarEvent: vi.fn(async () => undefined),
  cancelCalendarEvent: vi.fn(async () => undefined),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => mockAppointment),
  setAppointmentForPhone,
  clearAppointmentForPhone: vi.fn(async () => undefined),
}));
vi.mock('../conversationStore', () => ({
  getConversationCtwaClid: vi.fn(async () => null),
  recordOutgoingMessage: vi.fn(async () => ({}) as any),
}));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => null),
  resolveProductPrice: vi.fn(),
  parsePriceToNumber: vi.fn(() => 0),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAiCriarAgendamento(): GoogleGenAI {
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
            const call = { name: 'criar_agendamento', args: { titulo: 'Microlips', data_hora_inicio: '2026-08-10T10:00:00', data_hora_fim: '2026-08-10T11:30:00' } };
            return { functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] } as any;
          }
          return { functionCalls: [] } as any;
        }
        return { text: JSON.stringify({ phase: 'fechamento', bubbles: ['Confirmado!'], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('criar_agendamento — nunca sobrescreve um agendamento ativo (auditoria pós-lançamento)', () => {
  it('recusa criar um segundo agendamento quando já existe um ativo (futuro) pro contato', async () => {
    // Data bem no futuro de propósito — o teste não mocka o relógio, e a
    // checagem agora é "o agendamento existente ainda não passou?".
    mockAppointment = { eventId: 'evt-antigo', summary: 'Efecto 30+', startIso: '2030-08-09T09:00:00', endIso: '2030-08-09T10:30:00' };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(setAppointmentForPhone).not.toHaveBeenCalled();
  });

  it('cria normalmente quando o contato não tem agendamento ativo', async () => {
    mockAppointment = null;
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(setAppointmentForPhone).toHaveBeenCalledTimes(1);
  });

  it('permite criar um agendamento novo quando o único existente já passou, e reseta o estado de pagamento', async () => {
    // Achado real em produção: cliente com um agendamento antigo (já
    // atendido e pago) volta por um serviço diferente — isso não pode cair
    // em "já tem um ativo", e o novo registro não pode herdar o
    // payment_status do ciclo antigo.
    mockAppointment = { eventId: 'evt-antigo', summary: 'Pelo a Pelo', startIso: '2026-08-09T09:00:00', endIso: '2026-08-09T10:30:00' };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(setAppointmentForPhone).toHaveBeenCalledTimes(1);
    expect(setAppointmentForPhone).toHaveBeenCalledWith(
      'tenant-a',
      '595981234567',
      expect.objectContaining({ summary: 'Microlips' }),
      { resetPaymentState: true }
    );
  });
});

describe('criar_agendamento — gate de pagamento (issue #279): nunca apaga um ciclo de pagamento ainda não resolvido', () => {
  it('recusa criar um agendamento novo quando o ciclo anterior (já passado) tem comprovante pending_verification', async () => {
    // Mesmo cenário do teste "permite criar... já passou" acima, mas agora
    // com um comprovante que NINGUÉM decidiu ainda — resetPaymentState:true
    // apagaria esse rastro pra sempre sem decisão humana nenhuma.
    mockAppointment = { eventId: 'evt-antigo', summary: 'Pelo a Pelo', startIso: '2026-08-09T09:00:00', endIso: '2026-08-09T10:30:00', paymentStatus: 'pending_verification' };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(setAppointmentForPhone).not.toHaveBeenCalled();
  });

  it('recusa criar um agendamento novo quando o ciclo anterior (já passado) tem comprovante rejected ainda não limpo', async () => {
    mockAppointment = { eventId: 'evt-antigo', summary: 'Pelo a Pelo', startIso: '2026-08-09T09:00:00', endIso: '2026-08-09T10:30:00', paymentStatus: 'rejected' };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(setAppointmentForPhone).not.toHaveBeenCalled();
  });

  it('permite criar normalmente quando o ciclo anterior (já passado) foi resolvido (verified/confirmed)', async () => {
    mockAppointment = { eventId: 'evt-antigo', summary: 'Pelo a Pelo', startIso: '2026-08-09T09:00:00', endIso: '2026-08-09T10:30:00', paymentStatus: 'confirmed' };
    createCalendarEvent.mockClear();
    setAppointmentForPhone.mockClear();

    await generateAutoReplyForText(
      'tenant-a', makeFakeAiCriarAgendamento(), 'quero marcar microlips amanhã 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(setAppointmentForPhone).toHaveBeenCalledTimes(1);
  });
});
