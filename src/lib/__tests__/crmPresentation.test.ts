import { describe, expect, it } from 'vitest';
import { crmProbability, formatCrmTaskDate } from '../crmPresentation';
describe('apresentação dos dados do CRM', () => {
  it('distingue zero de ausência ou probabilidade inválida', () => {
    expect(crmProbability(0)).toBe(0);expect(crmProbability(100)).toBe(100);
    for (const value of [undefined, null, NaN, Infinity, -1, 101, '50']) expect(crmProbability(value)).toBeNull();
  });
  it('preserva prazos antigos e exibe datas reais sem inventar amanhã', () => {
    expect(formatCrmTaskDate('Hoje 15:00', 'pt-BR')).toBe('Hoje 15:00');
    expect(formatCrmTaskDate('2026-11-24', 'pt-BR')).toBe('24/11/2026');
    const iso='2026-11-24T18:30:00.000Z';
    expect(formatCrmTaskDate(iso,'pt-BR')).toBe(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(iso)));
  });
});
