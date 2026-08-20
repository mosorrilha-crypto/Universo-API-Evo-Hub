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
const findWeeklyAvailability = vi.fn(async () => [] as any[]);

vi.mock('../googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  checkFreeBusy,
  createCalendarEvent,
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

  it('Etapa 6 — corrige quando o modelo cita um horário fora dos que consultar_disponibilidade_semana realmente devolveu', async () => {
    // Horários padrão do estúdio (08:30/13:30/16:30/18:30) — consultar_disponibilidade_semana
    // filtra a resposta bruta de findWeeklyAvailability pra só esses, ver executeCalendarTool.
    findWeeklyAvailability.mockResolvedValue([
      { date: '2026-08-10', slots: [{ start: '08:30', end: '09:30' }, { start: '13:30', end: '14:30' }] },
    ]);
    let toolCallCount = 0;
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          }
          if (req.config?.tools) {
            toolCallCount++;
            if (toolCallCount === 1) {
              const call = { name: 'consultar_disponibilidade_semana', args: {} };
              return {
                functionCalls: [call],
                candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }],
              } as any;
            }
            return { functionCalls: [] } as any;
          }
          // 11:00 nunca esteve na lista devolvida pela ferramenta (só 08:30 e 13:30) — alucinação.
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Temos as 11:00 livre essa semana!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).not.toContain('11:00');
    // A correção deve oferecer um dos horários realmente confirmados.
    expect(result?.bubbles.join(' ')).toMatch(/08:30|13:30/);
  });

  it('pedido real (20/08/2026) — só oferece os horários PADRÃO (08:30/13:30/16:30/18:30), mesmo quando outros horários reais também estão livres', async () => {
    // 09:00 e 11:00 estão livres de verdade (findWeeklyAvailability devolveria),
    // mas não são horário padrão — consultar_disponibilidade_semana (executeCalendarTool)
    // precisa filtrar pra só 08:30/13:30 antes de devolver pro modelo.
    findWeeklyAvailability.mockResolvedValue([
      { date: '2026-08-10', slots: [{ start: '08:30', end: '09:30' }, { start: '09:00', end: '10:00' }, { start: '11:00', end: '12:00' }, { start: '13:30', end: '14:30' }] },
    ]);
    let toolCallCount = 0;
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          }
          if (req.config?.tools) {
            toolCallCount++;
            if (toolCallCount === 1) {
              const call = { name: 'consultar_disponibilidade_semana', args: {} };
              return {
                functionCalls: [call],
                candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }],
              } as any;
            }
            return { functionCalls: [] } as any;
          }
          // Modelo cita um horário livre de verdade, mas fora dos padrão — deve ser corrigido igual a uma alucinação.
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Temos as 09:00 livre!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).not.toContain('09:00');
    expect(result?.bubbles.join(' ')).not.toContain('11:00');
    expect(result?.bubbles.join(' ')).toMatch(/08:30|13:30/);
  });

  it('quando o fallback dispara com horários confirmados, também preenche quickReplyOptions com botões reais (pedido real, 20/08/2026)', async () => {
    findWeeklyAvailability.mockResolvedValue([
      { date: '2026-08-10', slots: [{ start: '08:30', end: '09:30' }, { start: '13:30', end: '14:30' }] },
    ]);
    let toolCallCount = 0;
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          }
          if (req.config?.tools) {
            toolCallCount++;
            if (toolCallCount === 1) {
              const call = { name: 'consultar_disponibilidade_semana', args: {} };
              return {
                functionCalls: [call],
                candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }],
              } as any;
            }
            return { functionCalls: [] } as any;
          }
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Temos as 11:00 livre essa semana!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'quais horários vocês têm essa semana?', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.quickReplyOptions).toBeDefined();
    expect(result?.quickReplyOptions?.buttons).toEqual([
      { id: 'horario_08:30', title: '08:30' },
      { id: 'horario_13:30', title: '13:30' },
    ]);
    // Máximo de 3 botões (limite da própria Meta pra reply buttons).
    expect(result?.quickReplyOptions?.buttons.length).toBeLessThanOrEqual(3);
  });

  it('NÃO apaga a resposta quando o cliente só reconfirma/pede a localização de um agendamento JÁ REAL, mesmo sem nenhuma ferramenta rodar nesta mensagem (achado real em produção: "Ok ok" / "la ubicación no me enviaste" apagava a resposta certa e virava uma frase genérica em português)', async () => {
    getAppointmentForPhone.mockResolvedValue({
      eventId: 'evt-real-1',
      summary: 'Diseño con Henna',
      startIso: '2026-08-10T14:00:00',
      endIso: '2026-08-10T14:30:00',
      paymentStatus: null,
    });
    let toolCallCount = 0;
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents?.[0]?.text?.includes('Classifique a intenção principal')) {
            return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          }
          if (req.config?.tools) {
            toolCallCount++;
            // Nenhuma ferramenta nova precisa rodar — o cliente só agradeceu/pediu a localização de novo.
            return { functionCalls: [] } as any;
          }
          return { text: JSON.stringify({ phase: 'fechamento', bubbles: ['¡Te paso! Estamos en Calle Paso Bogarín 3665. ¿Nos vemos hoy a las 14:00 entonces?'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'la ubicación no me enviaste', 'Cliente', undefined, undefined,
      '595981234567', CALENDAR_CONFIG
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles.join(' ')).toContain('14:00');
    expect(result?.bubbles.join(' ')).toContain('Paso Bogarín');
    expect(result?.needsHumanConfirmation).toBe(false);
    expect(result?.stopAutoReply).toBe(false);
    getAppointmentForPhone.mockResolvedValue(null);
  });
});
