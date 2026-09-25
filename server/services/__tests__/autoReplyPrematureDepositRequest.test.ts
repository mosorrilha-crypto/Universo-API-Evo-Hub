/**
 * TASK-0447 — achado real em produção (23/09/2026, cliente "Mika", tenant
 * Monique — Evolution): a especialista de agendamento respondeu "Perfecto,
 * Mika! Te anoto para mañana jueves a las 13:30 hs." seguido do pedido da
 * seña + comprovante, SEM nenhuma ferramenta de agenda ter rodado nesta
 * mensagem (nem criar_agendamento nem criar_pre_reserva) — nenhuma linha
 * chegou a existir em appointments/pre_reservations pra ela. O gate
 * determinístico de confirmação prematura (containsPrematureBookingConfirmation,
 * já existente desde 16/08/2026) só cobria frases com "confirmado"/
 * "agendado" — "te anoto" escapava da lista, então o texto saiu pro cliente
 * como se o horário estivesse garantido, com instrução de transferência
 * bancária real. Este teste reproduz o cenário exato (nenhuma tool call,
 * texto pedindo seña + comprobante) e confirma que o gate agora corrige a
 * resposta antes de sair.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy: vi.fn(async () => true),
  createCalendarEvent: vi.fn(async () => 'evt-novo'),
  rescheduleCalendarEvent: vi.fn(async () => undefined),
  cancelCalendarEvent: vi.fn(async () => undefined),
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => null),
  setAppointmentForPhone: vi.fn(async () => undefined),
  clearAppointmentForPhone: vi.fn(async () => undefined),
  createAppointmentHold: vi.fn(async () => undefined),
  findOverlappingHold: vi.fn(async () => undefined),
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

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

/**
 * Reproduz a resposta real de produção: a única ferramenta que roda é
 * verificar_disponibilidade (uma LEITURA — confirma que 13:30 está livre,
 * sem criar nada em appointments/pre_reservations), condizente com o trace
 * real da Mika ("RESTRIÇÃO OBRIGATÓRIA DE HORÁRIO: ... 13:30" no contexto,
 * sem nenhum resumo de criar_agendamento/criar_pre_reserva). O texto final
 * pede a seña + comprobante como se o horário estivesse garantido.
 */
function makeFakeAiSoftConfirmationNoTool(): GoogleGenAI {
  let toolCallCount = 0;
  return {
    models: {
      generateContent: async (req: any) => {
        if (req.contents?.[0]?.parts?.[0]?.text?.includes('Classifique a intenção principal') || req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
        }
        if (req.config?.tools) {
          toolCallCount++;
          if (toolCallCount === 1) {
            const call = { name: 'verificar_disponibilidade', args: { data_hora_inicio: '2026-09-24T13:30:00', data_hora_fim: '2026-09-24T15:00:00' } };
            return { functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] } as any;
          }
          return { functionCalls: [] } as any;
        }
        return {
          text: JSON.stringify({
            phase: 'fechamento',
            bubbles: [
              'Perfecto, Mika! Te anoto para mañana jueves a las 13:30 hs.',
              'Para confirmar tu lugar manejamos una seña de Gs 50.000, que se descuenta del total. Podés transferir al CI o Alias 9518111 a nombre de Monique Sorrilha y me enviás el comprobante por acá.',
            ],
            needsHumanConfirmation: true,
          }),
        } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('TASK-0447 — gate de agendamento inexistente cobre pedido de seña sem tool call (caso real Mika)', () => {
  it('corrige a resposta quando o modelo pede a seña/comprobante sem nenhum agendamento real e sem tool call nesta mensagem', async () => {
    const result = await generateAutoReplyForText(
      'tenant-monique', makeFakeAiSoftConfirmationNoTool(), 'Mañana 13:30', 'Mika', undefined, undefined,
      '595983156656', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    const joined = (result?.bubbles || []).join(' ');
    expect(joined).not.toMatch(/seña/i);
    expect(joined).not.toMatch(/comprobante/i);
    expect(joined).not.toMatch(/te anoto/i);
    expect(joined).toContain('Dejame confirmar bien la disponibilidad antes de asegurarte el turno');
  });
});
