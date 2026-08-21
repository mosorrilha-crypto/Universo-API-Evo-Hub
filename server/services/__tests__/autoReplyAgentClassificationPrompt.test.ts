/**
 * Achado real em produção (print do painel, 10/08/2026): num agendamento em
 * andamento, o cliente perguntou "La ubicación me podrías enviar" (pedindo o
 * endereço) e a IA respondeu com a mesma frase genérica de "vou confirmar o
 * horário" duas vezes seguidas, ignorando a pergunta — sinal de que o
 * classificador de intenção (classifyAgent) rotulou a pergunta de endereço
 * como "agendamento" em vez de "faq" (o histórico recente de agendamento na
 * conversa provavelmente pesou na classificação), fazendo cair no fallback
 * de anti-alucinação (Epic 4.5.7) em vez de responder com o endereço real da
 * base de conhecimento. Corrigido no prompt do classificador: pergunta
 * factual (endereço, horário de funcionamento) é sempre "faq", mesmo no meio
 * de um fluxo de agendamento.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => false),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent: vi.fn(async () => 'evt-1'),
  rescheduleCalendarEvent: vi.fn(),
  cancelCalendarEvent: vi.fn(),
  findWeeklyAvailability: vi.fn(async () => []),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => null),
  setAppointmentForPhone: vi.fn(async () => undefined),
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
  findProductDurationMinutes: vi.fn(() => undefined),
}));

const { generateAutoReplyForText } = await import('../autoReply');

describe('classifyAgent — prompt do roteador orienta pergunta de endereço pra "faq"', () => {
  it('inclui instrução explícita: pergunta factual (endereço/localização) nunca é "agendamento", mesmo em fluxo de agendamento', async () => {
    let routerPrompt = '';
    const ai = {
      models: {
        generateContent: async (req: any) => {
          const text = req.contents?.[0]?.text as string;
          if (text?.includes('Classifique a intenção principal')) {
            routerPrompt = text;
            return { text: JSON.stringify({ agent: 'faq' }) } as any;
          }
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Fica na Rua X, 123.'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'La ubicación me podrías enviar', 'Cliente', undefined, undefined,
      '595981234567', { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' }
    );

    expect(routerPrompt).toContain('endereço/localização');
    expect(routerPrompt.toLowerCase()).toContain('nunca "agendamento"');
    expect(result?.bubbles).toEqual(['Fica na Rua X, 123.']);
    // Nunca deve cair no fallback genérico de anti-alucinação do fluxo de agendamento.
    expect(result?.bubbles.join(' ')).not.toMatch(/confirmar certinho esse horário/i);
  });

  it('prioriza perguntas concretas de localização e preço antes de avançar para agenda', async () => {
    let specialistInstruction = '';
    const ai = {
      models: {
        generateContent: async (req: any) => {
          const text = req.contents?.[0]?.text as string;
          if (text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'faq' }) } as any;
          }
          specialistInstruction = req.config?.systemInstruction || '';
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Estamos en Luque. El combo cuesta Gs 850.000.'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-priority', ai, 'Dónde queda en Luque y cuánto está?', 'Cliente', 'Link de localização (Google Maps): https://maps.test', undefined,
      '595981234567'
    );

    expect(specialistInstruction).toContain('PRIORIDADE ABSOLUTA');
    expect(specialistInstruction).toContain('Quando pedir preço e localização juntos, responda ambos no mesmo turno');
    expect(result?.bubbles.join(' ')).toContain('Gs 850.000');
  });
});
