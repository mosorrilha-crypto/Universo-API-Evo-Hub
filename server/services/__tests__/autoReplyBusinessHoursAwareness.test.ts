/**
 * Achado real em produção (teste ao vivo, domingo 09/08/2026 às 17:37 —
 * expediente de domingo termina às 17:00): o cliente perguntou "posso fazer
 * hoje?" sem citar um horário específico, então a regra "falta informação
 * essencial, não chame ferramenta" corretamente impediu qualquer chamada de
 * agenda — mas isso também significava que NENHUM checador real de horário
 * de funcionamento rodava, e o especialista (que escreve a mensagem final)
 * ofereceu "hoje" como opção já com o estúdio fechado. Corrigido: o status
 * de expediente de hoje agora é calculado sempre que o agente classifica
 * como "agendamento", e chega ao especialista via extraContext mesmo quando
 * nenhuma ferramenta de agenda roda nesta mensagem.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
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

const getTenantBusinessHours = vi.fn(async () => ({ '0': { open: '09:00', close: '17:00' } }));
vi.mock('../tenantProfileStore', async () => {
  // importActual: mantém a formatação REAL de formatBusinessHoursForPrompt
  // (senão o teste novo que confere o texto injetado testaria um mock, não
  // o comportamento de verdade) — só getTenantBusinessHours é controlado.
  const actual = await vi.importActual<typeof import('../tenantProfileStore')>('../tenantProfileStore');
  return {
    ...actual,
    DEFAULT_SEGMENT: 'beauty_studio',
    getTenantBusinessHours,
  };
});

const { generateAutoReplyForText } = await import('../autoReply');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function makeFakeAiCapturingSpecialistPrompt(capturedUserContents: string[], specialistBubble: string, classifiedAgent: string = 'agendamento'): GoogleGenAI {
  return {
    models: {
      generateContent: async (req: any) => {
        if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
          return { text: JSON.stringify({ agent: classifiedAgent }) } as any;
        }
        if (req.config?.tools) {
          // Mensagem vaga ("hoje?" sem horário) — o próprio prompt de ferramentas
          // instrui a não chamar nada faltando dia/horário específico.
          return { functionCalls: [] } as any;
        }
        capturedUserContents.push(req.contents[0].text);
        return { text: JSON.stringify({ phase: 'informacao', bubbles: [specialistBubble], needsHumanConfirmation: false }) } as any;
      },
    },
  } as unknown as GoogleGenAI;
}

describe('generateAutoReplyForText — consciência de horário de funcionamento (sem ferramenta rodando)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('avisa o especialista que hoje (domingo) já fechou, mesmo sem nenhuma ferramenta de agenda ter rodado', async () => {
    // Domingo 09/08/2026 21:37 UTC = 17:37 em America/Asuncion (UTC-4).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T21:37:00Z'));

    const captured: string[] = [];
    const ai = makeFakeAiCapturingSpecialistPrompt(captured, 'Posso te avisar assim que tivermos um horário disponível!');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'posso fazer as sobrancelhas hoje?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(getTenantBusinessHours).toHaveBeenCalledWith('tenant-a');
    const prompt = captured.join(' ');
    expect(prompt).toContain('já fechou por hoje');
    expect(prompt).toContain('NUNCA ofereça nem confirme "hoje"');
  });

  it('avisa que o expediente de hoje está aberto quando dentro do horário', async () => {
    // Domingo 09/08/2026 17:00 UTC = 13:00 em America/Asuncion — dentro de 09:00–17:00.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T17:00:00Z'));

    const captured: string[] = [];
    const ai = makeFakeAiCapturingSpecialistPrompt(captured, 'Temos horários disponíveis hoje ainda, quer que eu verifique?');

    await generateAutoReplyForText(
      'tenant-a', ai, 'posso fazer as sobrancelhas hoje?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    const prompt = captured.join(' ');
    expect(prompt).toContain('dentro do horário de atendimento');
  });

  it('injeta o horário de funcionamento real no contexto mesmo pra mensagem classificada como "faq" (não agendamento) — única fonte, não só um texto solto na base de conhecimento', async () => {
    const captured: string[] = [];
    const ai = makeFakeAiCapturingSpecialistPrompt(captured, 'A gente atende segunda a sexta, das 07h30 às 20h.', 'faq');

    await generateAutoReplyForText(
      'tenant-a', ai, 'que horas vocês abrem?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(getTenantBusinessHours).toHaveBeenCalledWith('tenant-a');
    const prompt = captured.join(' ');
    expect(prompt).toContain('Horário de funcionamento');
  });
});
