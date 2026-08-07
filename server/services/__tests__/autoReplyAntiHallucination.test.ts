/**
 * Epic 4.5.7 — depois que as ferramentas de agenda rodam, nenhum horário
 * citado na resposta final pode divergir do que foi realmente confirmado
 * (verificar_disponibilidade com disponivel:true, ou criar/remarcar com
 * sucesso). Sem essa validação, o modelo pode "alucinar" um horário que
 * nunca foi checado de verdade — achado numa auditoria comparativa contra
 * o projeto antigo da Monique (que já tinha essa rede de segurança).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const checkFreeBusy = vi.fn(async () => true);
const createCalendarEvent = vi.fn(async () => 'evt-1');

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy,
  createCalendarEvent,
  rescheduleCalendarEvent: vi.fn(),
  cancelCalendarEvent: vi.fn(),
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
}));

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAi(specialistBubble: string): GoogleGenAI {
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
        return { text: JSON.stringify({ phase: 'informacao', bubbles: [specialistBubble], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — anti-alucinação de horário (Epic 4.5.7)', () => {
  it('corrige a resposta quando o modelo cita um horário nunca confirmado pela ferramenta', async () => {
    checkFreeBusy.mockResolvedValue(true);
    const ai = makeFakeAi('Perfeito, ficou marcado para as 15:00!'); // ferramenta confirmou 10:00, modelo citou 15:00

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar pra amanhã de manhã', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).toContain('10:00');
    expect(result?.bubbles.join(' ')).not.toContain('15:00');
  });

  it('não mexe na resposta quando o horário citado bate com o confirmado', async () => {
    checkFreeBusy.mockResolvedValue(true);
    const ai = makeFakeAi('Perfeito, ficou marcado para as 10:00!');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar pra amanhã de manhã', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result?.bubbles).toEqual(['Perfeito, ficou marcado para as 10:00!']);
  });

  it('corrige mesmo quando a ferramenta só confirmou horário OCUPADO (sem nenhum horário livre confirmado) e o modelo sugere uma "alternativa" nunca checada', async () => {
    // Achado numa auditoria pós-lançamento: checkFreeBusy=false não gera
    // nenhum confirmedTimeHHmm — antes da correção, isso desligava a
    // validação inteira (gate era confirmedTimes.length), deixando passar
    // qualquer "sugestão" inventada pelo modelo sem checar a agenda real.
    checkFreeBusy.mockResolvedValue(false);
    const ai = makeFakeAi('Que pena, 10:00 já está ocupado! Que tal às 16:00?'); // 16:00 nunca foi verificado

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar às 10h de amanhã', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).not.toContain('16:00');
  });
});
