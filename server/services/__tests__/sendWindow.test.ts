import { describe, expect, it } from 'vitest';
import { isValidTimeOfDay, isValidTimezone, isWithinSendWindow } from '../sendWindow';

describe('isValidTimeOfDay', () => {
  it('aceita HH:MM válido', () => {
    expect(isValidTimeOfDay('09:00')).toBe(true);
    expect(isValidTimeOfDay('23:59')).toBe(true);
    expect(isValidTimeOfDay('00:00')).toBe(true);
  });

  it('rejeita formato inválido', () => {
    expect(isValidTimeOfDay('9:00')).toBe(false);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeOfDay('12:60')).toBe(false);
    expect(isValidTimeOfDay('meio-dia')).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it('aceita fuso IANA conhecido', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('rejeita fuso desconhecido', () => {
    expect(isValidTimezone('Marte/Base_Um')).toBe(false);
  });
});

describe('isWithinSendWindow', () => {
  it('sem janela definida (start/end nulos) sempre permite — preserva comportamento anterior', () => {
    expect(isWithinSendWindow(new Date('2026-08-30T03:00:00Z'), null, null, 'UTC')).toBe(true);
  });

  it('permite dentro da janela normal (não cruza meia-noite)', () => {
    // 10:00 UTC está dentro de 09:00-18:00 UTC.
    expect(isWithinSendWindow(new Date('2026-08-30T10:00:00Z'), '09:00', '18:00', 'UTC')).toBe(true);
  });

  it('bloqueia fora da janela normal', () => {
    // 20:00 UTC está fora de 09:00-18:00 UTC.
    expect(isWithinSendWindow(new Date('2026-08-30T20:00:00Z'), '09:00', '18:00', 'UTC')).toBe(false);
  });

  it('respeita o fuso horário da campanha, não o UTC bruto', () => {
    // 10:00 UTC = 07:00 em America/Sao_Paulo (UTC-3) — fora de 09:00-18:00 local.
    expect(isWithinSendWindow(new Date('2026-08-30T10:00:00Z'), '09:00', '18:00', 'America/Sao_Paulo')).toBe(false);
    // 13:00 UTC = 10:00 em America/Sao_Paulo — dentro de 09:00-18:00 local.
    expect(isWithinSendWindow(new Date('2026-08-30T13:00:00Z'), '09:00', '18:00', 'America/Sao_Paulo')).toBe(true);
  });

  it('janela que cruza a meia-noite (ex.: 22:00-06:00) inclui as duas pontas', () => {
    expect(isWithinSendWindow(new Date('2026-08-30T23:00:00Z'), '22:00', '06:00', 'UTC')).toBe(true);
    expect(isWithinSendWindow(new Date('2026-08-30T02:00:00Z'), '22:00', '06:00', 'UTC')).toBe(true);
    expect(isWithinSendWindow(new Date('2026-08-30T12:00:00Z'), '22:00', '06:00', 'UTC')).toBe(false);
  });

  it('start igual a end é tratado como "sem restrição"', () => {
    expect(isWithinSendWindow(new Date('2026-08-30T12:00:00Z'), '09:00', '09:00', 'UTC')).toBe(true);
  });
});
