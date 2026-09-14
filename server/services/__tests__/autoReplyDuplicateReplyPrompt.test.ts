/**
 * TASK-0414 (achado real, tenant Dr. Daniel, "Lizandra", 14/09/2026): uma
 * rajada de 3 mensagens do cliente chegou picotada demais pro buffer de
 * silêncio (messageBuffer.ts, 10s) agrupar tudo num turno só — as duas
 * primeiras viraram um turno do agente (preço + pergunta de manhã/tarde), e
 * a terceira, chegando pouco depois, virou um SEGUNDO turno independente que
 * repetiu quase a mesma resposta (preço + manhã/tarde de novo) 24s depois,
 * já com a resposta anterior gravada no histórico (`runExclusive` em
 * perPhoneQueue.ts serializa os dois turnos, então o segundo turno já via o
 * primeiro no histórico — o modelo tinha o dado, só não tinha a instrução
 * explícita pra não repetir preço/pergunta de horário quando quem "reabre" o
 * assunto é ele mesmo, não o cliente).
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
  getRuntimeKnowledgeBase: vi.fn(async () => ({ knowledgeBase: null, source: 'published_documents' as const })),
  resolveProductPrice: vi.fn(),
  parsePriceToNumber: vi.fn(() => 0),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
  findProductDurationMinutes: vi.fn(() => undefined),
}));

const { generateAutoReplyForText } = await import('../autoReply');

describe('anti-repetição quando o próprio agente respondeu por último (rajada em dois turnos)', () => {
  it('inclui instrução explícita pra não repetir preço/pergunta de horário quando quem reabriu foi o próprio agente', async () => {
    let specialistInstruction = '';
    const ai = {
      models: {
        generateContent: async (req: any) => {
          const text = req.contents?.[0]?.text as string;
          if (text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'faq' }) } as any;
          }
          specialistInstruction = req.config?.systemInstruction || '';
          return {
            text: JSON.stringify({
              phase: 'informacao',
              bubbles: ['Que bom que você já tem o diagnóstico! Fico no aguardo da sua resposta sobre o período.'],
              needsHumanConfirmation: false,
            }),
          } as any;
        },
      },
    } as unknown as GoogleGenAI;

    // Histórico real do achado: a ÚLTIMA linha antes da nova mensagem do
    // cliente já é do próprio agente (preço + manhã/tarde), simulando a
    // rajada picotada em dois turnos.
    const history: { sender: 'lead' | 'agent'; text?: string }[] = [
      { sender: 'lead', text: 'Gostaria de marcar uma consulta com ele' },
      { sender: 'agent', text: 'O valor da consulta é R$ 120,00. Qual dia fica melhor para você, e você prefere atendimento pela manhã ou à tarde?' },
    ];

    await generateAutoReplyForText(
      'tenant-a', ai, 'Estou com meu braço doendo, já fiz ultrassom e já tenho o diagnóstico', 'Lizandra', undefined, history,
      '5567992658072'
    );

    expect(specialistInstruction).toContain('enviada por VOCÊ MESMO (o agente)');
    expect(specialistInstruction).toContain('NÃO repita o preço nem essa pergunta');
  });
});
