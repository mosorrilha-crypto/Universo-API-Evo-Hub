/**
 * Achado em auditoria comparativa (07/08/2026): nada no Universo impedia
 * criar um agendamento fora do horário de atendimento, contanto que o
 * Google Calendar mostrasse aquele horário como livre. isWithinBusinessHours
 * é a checagem nova (googleCalendar.ts) — trava aqui pra não regredir.
 */
import { describe, expect, it } from 'vitest';
import { isWithinBusinessHours } from '../googleCalendar';
import type { BusinessHours } from '../tenantProfileStore';

const MONIQUE_HOURS: BusinessHours = {
  '1': { open: '07:30', close: '20:00' }, // segunda
  '6': { open: '08:00', close: '13:00' }, // sábado
};

describe('isWithinBusinessHours', () => {
  it('sem horário configurado (null), nunca restringe', () => {
    expect(isWithinBusinessHours(null, '2026-08-10T22:00:00', '2026-08-10T23:00:00')).toBe(true);
  });

  it('dentro do expediente de segunda-feira', () => {
    // 2026-08-10 é uma segunda-feira
    expect(isWithinBusinessHours(MONIQUE_HOURS, '2026-08-10T10:00:00', '2026-08-10T11:30:00')).toBe(true);
  });

  it('fora do expediente — horário depois do fechamento', () => {
    expect(isWithinBusinessHours(MONIQUE_HOURS, '2026-08-10T20:30:00', '2026-08-10T21:30:00')).toBe(false);
  });

  it('fora do expediente — sábado fecha às 13h, pedido é 14h', () => {
    // 2026-08-15 é um sábado
    expect(isWithinBusinessHours(MONIQUE_HOURS, '2026-08-15T14:00:00', '2026-08-15T15:00:00')).toBe(false);
  });

  it('dia ausente do mapa (domingo) — tenant não atende', () => {
    // 2026-08-16 é um domingo, ausente de MONIQUE_HOURS neste teste
    expect(isWithinBusinessHours(MONIQUE_HOURS, '2026-08-16T10:00:00', '2026-08-16T11:00:00')).toBe(false);
  });

  it('sessão que cruzaria meia-noite é rejeitada', () => {
    expect(isWithinBusinessHours(MONIQUE_HOURS, '2026-08-10T23:30:00', '2026-08-11T00:30:00')).toBe(false);
  });
});
