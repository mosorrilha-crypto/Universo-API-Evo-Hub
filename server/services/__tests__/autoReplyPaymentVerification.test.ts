/**
 * Etapa 8 — o agente nunca decide "verificado" sozinho, mas precisa saber
 * o estado real (pending_verification/verified/rejected) pra não confirmar
 * o turno antes da hora, nem deixar de confirmar quando um operador já
 * verificou. A transição verified -> confirmed é a única que a IA executa
 * ela mesma (confirmPayment), sempre depois de um humano já ter decidido.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const confirmPayment = vi.fn(async () => undefined);
let mockAppointment: { eventId: string; summary: string; startIso: string; endIso: string; paymentStatus?: string } | null = null;

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent: vi.fn(async () => 'evt-novo'),
  rescheduleCalendarEvent: vi.fn(async () => undefined),
  cancelCalendarEvent: vi.fn(async () => undefined),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => mockAppointment),
  setAppointmentForPhone: vi.fn(async () => undefined),
  clearAppointmentForPhone: vi.fn(async () => undefined),
  confirmPayment,
}));
vi.mock('../conversationStore', () => ({
  getConversationCtwaClid: vi.fn(async () => null),
  recordOutgoingMessage: vi.fn(async () => ({}) as any),
}));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => null),
  resolveProductPrice: vi.fn(),
  parsePriceToNumber: vi.fn(() => 0),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAiCapturingUserContent(capturedUserContents: string[]): GoogleGenAI {
  return {
    models: {
      generateContent: async (req: any) => {
        if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
        }
        if (req.config?.tools) {
          return { functionCalls: [] } as any; // cliente só perguntando, sem ação de agenda nesta mensagem
        }
        capturedUserContents.push(req.contents[0].text);
        return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Já te aviso!'], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — consciência de payment_status (Etapa 8)', () => {
  it('pending_verification: avisa o especialista pra não confirmar, e não chama confirmPayment', async () => {
    mockAppointment = { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-10T10:00:00', endIso: '2026-08-10T11:30:00', paymentStatus: 'pending_verification' };
    confirmPayment.mockClear();
    const captured: string[] = [];

    await generateAutoReplyForText('tenant-a', makeFakeAiCapturingUserContent(captured), 'já confirmaram meu pagamento?', 'Cliente', undefined, undefined, '595981234567', CALENDAR_CONFIG);

    expect(confirmPayment).not.toHaveBeenCalled();
    expect(captured.join(' ')).toContain('NÃO confirme o turno');
  });

  it('verified: chama confirmPayment (transição pra confirmed) e avisa que pode confirmar', async () => {
    mockAppointment = { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-10T10:00:00', endIso: '2026-08-10T11:30:00', paymentStatus: 'verified' };
    confirmPayment.mockClear();
    const captured: string[] = [];

    await generateAutoReplyForText('tenant-a', makeFakeAiCapturingUserContent(captured), 'já confirmaram meu pagamento?', 'Cliente', undefined, undefined, '595981234567', CALENDAR_CONFIG);

    expect(confirmPayment).toHaveBeenCalledWith('tenant-a', '595981234567');
    expect(captured.join(' ')).toContain('pode confirmar o turno');
  });

  it('rejected: avisa pra não confirmar e pedir novo comprovante', async () => {
    mockAppointment = { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-10T10:00:00', endIso: '2026-08-10T11:30:00', paymentStatus: 'rejected' };
    confirmPayment.mockClear();
    const captured: string[] = [];

    await generateAutoReplyForText('tenant-a', makeFakeAiCapturingUserContent(captured), 'já confirmaram meu pagamento?', 'Cliente', undefined, undefined, '595981234567', CALENDAR_CONFIG);

    expect(confirmPayment).not.toHaveBeenCalled();
    expect(captured.join(' ')).toContain('rejeitado');
  });

  it('sem payment_status (undefined), não menciona nada sobre pagamento', async () => {
    mockAppointment = { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-10T10:00:00', endIso: '2026-08-10T11:30:00' };
    confirmPayment.mockClear();
    const captured: string[] = [];

    await generateAutoReplyForText('tenant-a', makeFakeAiCapturingUserContent(captured), 'quero remarcar', 'Cliente', undefined, undefined, '595981234567', CALENDAR_CONFIG);

    expect(confirmPayment).not.toHaveBeenCalled();
    expect(captured.join(' ')).not.toContain('Ações reais já executadas');
  });
});
