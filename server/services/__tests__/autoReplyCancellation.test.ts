/**
 * Epic 4.5.9 — política real de sinal (24h+ de antecedência devolve, menos
 * não devolve). Como o Universo não rastreia se o sinal foi pago, a decisão
 * de devolução nunca pode ser da IA sozinha: cancelamento com 24h+ de
 * antecedência escala pra humano em vez de cancelar automaticamente;
 * com menos de 24h (sem devolução em jogo), a IA cancela direto.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const cancelCalendarEvent = vi.fn(async () => undefined);
const clearAppointmentForPhone = vi.fn(async () => undefined);
let mockAppointment: { eventId: string; summary: string; startIso: string; endIso: string } | null = null;

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent: vi.fn(async () => 'evt-novo'),
  rescheduleCalendarEvent: vi.fn(async () => undefined),
  cancelCalendarEvent,
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => mockAppointment),
  setAppointmentForPhone: vi.fn(async () => undefined),
  clearAppointmentForPhone,
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
  findProductDurationMinutes: vi.fn(() => undefined),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

/** "HH:mm daqui a X horas" no fuso de Asuncion (UTC-3, sem horário de verão) — mesma conta que o código sob teste faz com Date.parse(naive+'Z'). */
function naiveAsuncionInHours(hoursFromNow: number): string {
  const ms = Date.now() + hoursFromNow * 3_600_000 - 3 * 3_600_000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function makeFakeAiCancel(): GoogleGenAI {
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
            const call = { name: 'cancelar_agendamento', args: {} };
            return { functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] } as any;
          }
          return { functionCalls: [] } as any;
        }
        return { text: JSON.stringify({ phase: 'objecao', bubbles: ['Entendido, vou verificar isso.'], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — cancelamento sensível a antecedência (Epic 4.5.9)', () => {
  it('com 24h+ de antecedência, ESCALA e não cancela automaticamente', async () => {
    mockAppointment = { eventId: 'evt-1', summary: 'Microlips', startIso: naiveAsuncionInHours(48), endIso: naiveAsuncionInHours(49.5) };
    cancelCalendarEvent.mockClear();
    clearAppointmentForPhone.mockClear();

    const result = await generateAutoReplyForText(
      'tenant-a', makeFakeAiCancel(), 'quero cancelar meu horário', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(cancelCalendarEvent).not.toHaveBeenCalled();
    expect(clearAppointmentForPhone).not.toHaveBeenCalled();
    expect(result?.needsHumanConfirmation).toBe(true);
  });

  it('com menos de 24h de antecedência, cancela direto sem escalar por isso', async () => {
    mockAppointment = { eventId: 'evt-2', summary: 'Microlips', startIso: naiveAsuncionInHours(3), endIso: naiveAsuncionInHours(4.5) };
    cancelCalendarEvent.mockClear();
    clearAppointmentForPhone.mockClear();

    const result = await generateAutoReplyForText(
      'tenant-a', makeFakeAiCancel(), 'quero cancelar meu horário', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(cancelCalendarEvent).toHaveBeenCalledWith('tenant-a', CALENDAR_CONFIG, 'evt-2');
    expect(clearAppointmentForPhone).toHaveBeenCalled();
    expect(result?.needsHumanConfirmation).toBe(false);
  });
});
