/**
 * TASK-0348 — extensão do caminho rápido Groq/Llama (TASK-0346) pro
 * agendamento, restrita DE PROPÓSITO só à classificação de consulta de
 * disponibilidade (nunca criar/remarcar/cancelar, que continuam só no
 * Gemini function-calling). Quando o Groq classifica a mensagem como
 * "consulta_semana"/"consulta_horario_especifico", a resposta vem direto
 * das mesmas funções determinísticas usadas pelo Gemini
 * (findWeeklyAvailability/checkFreeBusy) e o loop de function-calling do
 * Gemini NUNCA roda. Qualquer falha do Groq (rede, JSON malformado, "tipo"
 * fora do enum, "outro") cai pro loop normal do Gemini sem mudança de
 * comportamento.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const checkFreeBusy = vi.fn(async () => true);
const findWeeklyAvailability = vi.fn(async () => [] as any[]);

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy,
  createCalendarEvent: vi.fn(),
  rescheduleCalendarEvent: vi.fn(),
  cancelCalendarEvent: vi.fn(),
  findWeeklyAvailability,
}));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone: vi.fn(async () => null as any),
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
  getRuntimeKnowledgeBase: vi.fn(async () => ({ knowledgeBase: null, source: 'published_documents' as const })),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
  findProductDurationMinutes: vi.fn(() => undefined),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };
const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Temos horário sim!'], needsHumanConfirmation: false };

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function fakeGemini() {
  let toolCallCount = 0;
  const ai = {
    models: {
      generateContent: async (req: any) => {
        // Só é chamado se o router via Groq falhar também (não é o caso destes
        // testes — o mock de fetch abaixo sempre resolve o router).
        if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
        }
        if (req.config?.tools) {
          toolCallCount++;
          // Se o Groq tivesse falhado e caído aqui, o Gemini consultaria a semana de novo.
          if (toolCallCount === 1) {
            const call = { name: 'consultar_disponibilidade_semana', args: {} };
            return {
              functionCalls: [call],
              candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }],
            } as any;
          }
          return { functionCalls: [] } as any;
        }
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, getToolCallCount: () => toolCallCount };
}

/**
 * Até 3 requisições Groq por turno nesta rota: classificação do roteador
 * (classifyAgent), classificação da consulta de agendamento
 * (classifyAgendamentoConsultaViaGroq) e geração da resposta do especialista
 * (TASK-0346) — cada uma reconhecida pelo texto do próprio prompt (mesmo
 * padrão de distinção por marcador já usado no mock do Gemini nos outros
 * testes desta suíte), não pela ordem de chamada.
 */
function mockGroqFetch(consultaResponse: unknown) {
  global.fetch = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const prompt: string = body.messages[0].content;
    let content: unknown;
    if (prompt.includes('Classifique a intenção principal')) {
      content = { agent: 'agendamento', confidence: 0.9, reasoning: 'ok' };
    } else if (prompt.includes('SEM decidir nada além da classificação')) {
      content = consultaResponse;
    } else {
      content = SPECIALIST_REPLY;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    } as Response;
  });
}

describe('runAgendamentoTools — atalho de consulta via Groq → Gemini', () => {
  it('responde direto com a disponibilidade da semana quando o Groq classifica como consulta_semana, sem chamar o Gemini pra ferramentas', async () => {
    findWeeklyAvailability.mockResolvedValue([
      { date: '2026-08-10', slots: [{ start: '08:30', end: '09:30' }, { start: '13:30', end: '14:30' }] },
    ]);
    mockGroqFetch({ tipo: 'consulta_semana', servico: '', data_hora_inicio: '', data_hora_fim: '' });
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBe(0);
  });

  it('responde direto com a disponibilidade de um horário específico quando o Groq classifica como consulta_horario_especifico', async () => {
    checkFreeBusy.mockResolvedValue(true);
    mockGroqFetch({ tipo: 'consulta_horario_especifico', data_hora_inicio: '2026-08-10T10:00:00', data_hora_fim: '2026-08-10T11:00:00' });
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'o horário de amanhã às 10h está livre?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBe(0);
  });

  it('cai pro loop normal do Gemini quando o Groq classifica como "outro" (ex: pedido de criar/remarcar/cancelar)', async () => {
    mockGroqFetch({ tipo: 'outro' });
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quero marcar pra amanhã às 10h', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBeGreaterThan(0);
  });

  it('cai pro loop normal do Gemini quando o Groq devolve "tipo" fora do enum esperado', async () => {
    mockGroqFetch({ tipo: 'categoria_inventada' });
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBeGreaterThan(0);
  });

  it('cai pro loop normal do Gemini quando classifica como consulta_horario_especifico mas sem datas válidas', async () => {
    mockGroqFetch({ tipo: 'consulta_horario_especifico', data_hora_inicio: '', data_hora_fim: '' });
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'esse horário está livre?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBeGreaterThan(0);
  });

  it('cai pro loop normal do Gemini quando o Groq falha com HTTP não-2xx', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'erro simulado' } as Response));
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCallCount()).toBeGreaterThan(0);
  });

  it('sem groqApiKey, nunca chama fetch — comportamento inalterado (só Gemini)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    const { ai, getToolCallCount } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getToolCallCount()).toBeGreaterThan(0);
  });
});
