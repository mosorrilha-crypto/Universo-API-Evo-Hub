/**
 * validateBusinessHours guarda a entrada de POST /api/business-hours antes
 * de gravar — o agendamento automático real (describeBusinessHoursToday/
 * isWithinBusinessHours) confia cegamente no formato salvo, então um valor
 * mal formado gravado direto quebraria essa checagem silenciosamente.
 */
import { describe, expect, it } from 'vitest';
import { validateBusinessHours, formatBusinessHoursForPrompt } from '../tenantProfileStore';

describe('validateBusinessHours', () => {
  it('aceita um horário válido, com dias ausentes (tenant não atende nesses dias)', () => {
    expect(validateBusinessHours({ '1': { open: '07:30', close: '20:00' }, '6': { open: '08:00', close: '13:00' } })).toBe(true);
  });

  it('aceita objeto vazio (nenhum dia configurado)', () => {
    expect(validateBusinessHours({})).toBe(true);
  });

  it('rejeita chave de dia fora de 0-6', () => {
    expect(validateBusinessHours({ '7': { open: '08:00', close: '18:00' } })).toBe(false);
  });

  it('rejeita "HH:mm" mal formado', () => {
    expect(validateBusinessHours({ '1': { open: '7:30', close: '20:00' } })).toBe(false);
    expect(validateBusinessHours({ '1': { open: '07:30', close: '25:00' } })).toBe(false);
  });

  it('rejeita close no mesmo horário ou antes de open', () => {
    expect(validateBusinessHours({ '1': { open: '09:00', close: '09:00' } })).toBe(false);
    expect(validateBusinessHours({ '1': { open: '18:00', close: '09:00' } })).toBe(false);
  });

  it('rejeita valores que não são objeto', () => {
    expect(validateBusinessHours(null)).toBe(false);
    expect(validateBusinessHours('segunda a sexta')).toBe(false);
    expect(validateBusinessHours([{ open: '08:00', close: '18:00' }])).toBe(false);
  });
});

describe('formatBusinessHoursForPrompt', () => {
  it('null (tenant nunca configurou) devolve string vazia — nunca inventa horário', () => {
    expect(formatBusinessHoursForPrompt(null)).toBe('');
  });

  it('objeto vazio devolve string vazia', () => {
    expect(formatBusinessHoursForPrompt({})).toBe('');
  });

  it('lista os dias configurados em ordem segunda a domingo, pulando dias ausentes', () => {
    const text = formatBusinessHoursForPrompt({
      '1': { open: '07:30', close: '20:00' },
      '6': { open: '08:00', close: '13:00' },
      '0': { open: '09:00', close: '17:00' },
    });
    expect(text).toBe('Horário de funcionamento:\nSegunda: 07:30 às 20:00\nSábado: 08:00 às 13:00\nDomingo: 09:00 às 17:00');
  });
});
