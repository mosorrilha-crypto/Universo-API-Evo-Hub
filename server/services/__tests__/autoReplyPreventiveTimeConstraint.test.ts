/**
 * Follow-up do Epic 4.5.7 (achado de benchmark externo, 25/08/2026): até
 * aqui a única defesa contra o especialista citar um horário inventado era
 * o gate REATIVO (gera resposta livre, corrige depois se citar errado) —
 * ver autoReplyAntiHallucination.test.ts. Este arquivo cobre a camada nova,
 * PREVENTIVA: sempre que uma ferramenta de agenda confirma horário(s) nesta
 * mensagem, o especialista recebe uma restrição imperativa explícita
 * ("RESTRIÇÃO OBRIGATÓRIA DE HORÁRIO...") no seu próprio contexto, ANTES de
 * gerar a resposta — não só uma frase narrativa escondida no resumo de
 * ações. O gate reativo continua existindo (não foi removido nem alterado),
 * esta é uma camada adicional.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const checkFreeBusy = vi.fn(async () => true);
const findWeeklyAvailability = vi.fn(async () => [] as any[]);

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy,
  createCalendarEvent: vi.fn(async () => 'evt-1'),
  rescheduleCalendarEvent: vi.fn(),
  cancelCalendarEvent: vi.fn(),
  findWeeklyAvailability,
}));
const getAppointmentForPhone = vi.fn(async () => null as any);
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone,
  setAppointmentForPhone: vi.fn(async () => undefined),
  clearAppointmentForPhone: vi.fn(async () => undefined),
  confirmPayment: vi.fn(async () => null),
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

/** Captura o texto exato que chegou pro especialista (a chamada sem `config.tools`, depois do router e das ferramentas de agenda). */
function makeFakeAiCapturingSpecialistPrompt(specialistBubble: string, onSpecialistCall: (promptText: string) => void): GoogleGenAI {
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
            const call = { name: 'verificar_disponibilidade', args: { data_hora_inicio: '2026-08-10T10:00:00', data_hora_fim: '2026-08-10T11:30:00' } };
            return {
              functionCalls: [call],
              candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }],
            } as any;
          }
          return { functionCalls: [] } as any;
        }
        const promptText: string = req.contents?.[0]?.text || '';
        onSpecialistCall(promptText);
        return { text: JSON.stringify({ phase: 'informacao', bubbles: [specialistBubble], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — restrição preventiva de horário no contexto do especialista', () => {
  it('inclui a restrição obrigatória com o horário confirmado quando uma ferramenta de agenda confirma disponibilidade', async () => {
    checkFreeBusy.mockResolvedValue(true);
    let capturedPrompt = '';
    const ai = makeFakeAiCapturingSpecialistPrompt('Perfeito, ficou marcado para as 10:00!', (p) => { capturedPrompt = p; });

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar pra amanhã de manhã', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(capturedPrompt).toContain('RESTRIÇÃO OBRIGATÓRIA DE HORÁRIO');
    expect(capturedPrompt).toContain('10:00');
  });

  it('não inclui a restrição quando nenhum horário foi confirmado nesta mensagem (ex: faltou dado, nenhuma ferramenta rodou)', async () => {
    let capturedPrompt = '';
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          }
          if (req.config?.tools) {
            // Faltou dado -> nenhuma ferramenta chamada, igual ao comportamento real do modelo nesse caso.
            return { functionCalls: [] } as any;
          }
          const promptText: string = req.contents?.[0]?.text || '';
          capturedPrompt = promptText;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Claro, pra qual dia você prefere?'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar um horário', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(capturedPrompt).not.toContain('RESTRIÇÃO OBRIGATÓRIA DE HORÁRIO');
  });
});
