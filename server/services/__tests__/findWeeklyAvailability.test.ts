/**
 * Etapa 6 — findWeeklyAvailability (googleCalendar.ts) precisa: nunca
 * inventar expediente quando o tenant não configurou horário, pular dias
 * sem expediente, respeitar a duração real do serviço (slot que não cabe
 * inteiro não aparece), excluir horários já ocupados no Google Calendar
 * real, e fazer UMA chamada de freebusy pra semana inteira (não uma por
 * slot candidato).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

const freebusyQuery = vi.fn();
const setCredentials = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // Precisa ser uma função regular (não arrow) — googleCalendar.ts chama
      // isso com `new google.auth.OAuth2(...)`.
      OAuth2: vi.fn().mockImplementation(function OAuth2Mock(this: any) {
        this.setCredentials = setCredentials;
        this.on = vi.fn();
      }),
    },
    calendar: vi.fn(() => ({ freebusy: { query: freebusyQuery } })),
  },
}));

const { findWeeklyAvailability, findAvailabilityForDate, localNaiveToUtcIso } = await import('../googleCalendar');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };
// Mesmo horário usado em businessHours.test.ts — 2026-08-10 é segunda, 2026-08-15 é sábado.
const MONIQUE_HOURS = {
  '1': { open: '07:30', close: '20:00' }, // segunda
  '6': { open: '08:00', close: '13:00' }, // sábado
};

function seedDb(businessHours: typeof MONIQUE_HOURS | null) {
  initDb(createFakeSupabase({
    tenants: [{ id: TENANT_A, business_hours: businessHours }],
    tenant_calendar_tokens: [{ tenant_id: TENANT_A, refresh_token: 'refresh-token-x' }],
  }));
}

beforeEach(() => {
  freebusyQuery.mockReset();
  setCredentials.mockReset();
  freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [] } } } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // segunda-feira ao meio-dia UTC
});

afterEach(() => {
  vi.useRealTimers();
});

describe('findWeeklyAvailability', () => {
  it('sem horário configurado, nunca inventa expediente padrão — devolve lista vazia sem consultar o Google', async () => {
    seedDb(null);
    const result = await findWeeklyAvailability(TENANT_A, CALENDAR_CONFIG, 60);
    expect(result).toEqual([]);
    expect(freebusyQuery).not.toHaveBeenCalled();
  });

  it('pula dias sem expediente configurado, só devolve os dias com horário — numa única chamada de freebusy', async () => {
    seedDb(MONIQUE_HOURS);
    const result = await findWeeklyAvailability(TENANT_A, CALENDAR_CONFIG, 90);
    expect(result.map((d) => d.date)).toEqual(['2026-08-10', '2026-08-15']);
    expect(freebusyQuery).toHaveBeenCalledTimes(1);
  });

  it('slot que não cabe a duração inteira do serviço não aparece', async () => {
    seedDb(MONIQUE_HOURS);
    // Sábado: 08:00-13:00 (5h exatas). Com duração de 300min, só o slot das
    // 08:00 cabe inteiro (08:30 + 300min passaria de 13:00).
    const result = await findWeeklyAvailability(TENANT_A, CALENDAR_CONFIG, 300);
    const saturday = result.find((d) => d.date === '2026-08-15');
    expect(saturday?.slots).toEqual([{ start: '08:00', end: '13:00' }]);
  });

  it('não oferece horário de hoje que já passou, mesmo livre no Google Calendar (achado real 25/08/2026)', async () => {
    seedDb(MONIQUE_HOURS);
    // Segunda 07:30-20:00, "agora" é 14:30 local (Asunción) — 07:30/08:00
    // etc já passaram, mas nada está marcado como ocupado no Google.
    vi.setSystemTime(new Date(localNaiveToUtcIso('2026-08-10T14:30:00', 'America/Asuncion')));

    const result = await findWeeklyAvailability(TENANT_A, CALENDAR_CONFIG, 60);
    const monday = result.find((d) => d.date === '2026-08-10')!;
    const starts = monday.slots.map((s) => s.start);

    expect(starts).not.toContain('07:30');
    expect(starts).not.toContain('14:00'); // ainda dentro da hora atual, já passou
    expect(starts).toContain('15:00'); // primeiro slot depois de "agora"
  });

  it('slot ocupado no Google Calendar real não aparece na disponibilidade', async () => {
    seedDb(MONIQUE_HOURS);
    const busyStart = localNaiveToUtcIso('2026-08-15T09:00:00', 'America/Asuncion');
    const busyEnd = localNaiveToUtcIso('2026-08-15T10:00:00', 'America/Asuncion');
    freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [{ start: busyStart, end: busyEnd }] } } } });

    const result = await findWeeklyAvailability(TENANT_A, CALENDAR_CONFIG, 60);
    const saturday = result.find((d) => d.date === '2026-08-15')!;
    const starts = saturday.slots.map((s) => s.start);

    expect(starts).not.toContain('09:00'); // colide direto com o intervalo ocupado
    expect(starts).not.toContain('09:30'); // 09:30-10:30 também colide (sobreposição parcial)
    expect(starts).toContain('08:00'); // termina antes do horário ocupado começar
    expect(starts).toContain('10:00'); // começa exatamente quando o ocupado termina — sem sobreposição
  });
});

describe('findAvailabilityForDate', () => {
  it('devolve os mesmos horários livres que findWeeklyAvailability calcularia pra aquela data específica', async () => {
    seedDb(MONIQUE_HOURS);
    const busyStart = localNaiveToUtcIso('2026-08-15T09:00:00', 'America/Asuncion');
    const busyEnd = localNaiveToUtcIso('2026-08-15T10:00:00', 'America/Asuncion');
    freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [{ start: busyStart, end: busyEnd }] } } } });

    const slots = await findAvailabilityForDate(TENANT_A, CALENDAR_CONFIG, '2026-08-15', 60);
    const starts = slots.map((s) => s.start);

    expect(starts).not.toContain('09:00');
    expect(starts).toContain('08:00');
    expect(starts).toContain('10:00');
  });

  it('dia sem expediente configurado devolve lista vazia', async () => {
    seedDb(MONIQUE_HOURS);
    // 2026-08-11 é terça — não está em MONIQUE_HOURS.
    const slots = await findAvailabilityForDate(TENANT_A, CALENDAR_CONFIG, '2026-08-11', 60);
    expect(slots).toEqual([]);
  });
});
