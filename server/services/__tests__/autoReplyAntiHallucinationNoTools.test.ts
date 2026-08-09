/**
 * Achado real em produção (teste ao vivo com o número da Monique,
 * 09/08/2026): com o Google Calendar não conectado pro tenant, a IA
 * respondeu "Já deixei pré-agendado seu horário para segunda-feira, às
 * 10:00" sem NENHUMA ferramenta de agenda ter rodado — nem criar_pre_reserva,
 * nem criar_agendamento. O gate de anti-alucinação existente (Epic 4.5.7) só
 * validava horário citado CONTRA o que as ferramentas confirmaram, mas só
 * rodava quando `agendamentoToolsRan` era true — com o calendário
 * desconectado, `runAgendamentoTools` retorna vazio na primeira linha e o
 * gate inteiro ficava desligado, deixando a alucinação passar direto pro
 * cliente. Corrigido: citar QUALQUER horário específico quando nenhuma
 * ferramenta rodou nesta mensagem é sempre tratado como alucinação (a
 * própria instrução do agente já proíbe prometer horário nesse caso — isso é
 * a garantia estrutural pra quando o modelo não segue a instrução).
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

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAi(specialistBubble: string): GoogleGenAI {
  return {
    models: {
      generateContent: async (req: any) => {
        if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
        }
        // Calendário desconectado — runAgendamentoTools nunca chega a chamar generateContent com tools.
        return { text: JSON.stringify({ phase: 'fechamento', bubbles: [specialistBubble], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — anti-alucinação quando NENHUMA ferramenta de agenda roda', () => {
  it('corrige e escala pra humano quando o modelo alucina um horário "pré-agendado" sem o calendário conectado', async () => {
    const ai = makeFakeAi('Perfeito! Já deixei pré-agendado seu horário para segunda-feira, às 10:00.');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'pode ser segunda às 10', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).not.toContain('10:00');
    expect(result?.bubbles.join(' ')).not.toMatch(/pré-agendado|agendado/i);
    expect(result?.needsHumanConfirmation).toBe(true);
  });

  it('não mexe na resposta quando o modelo corretamente não cita nenhum horário específico', async () => {
    const ai = makeFakeAi('Posso confirmar sua disponibilidade e já te retorno, tá bom?');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'pode ser segunda às 10', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result?.bubbles).toEqual(['Posso confirmar sua disponibilidade e já te retorno, tá bom?']);
  });
});
