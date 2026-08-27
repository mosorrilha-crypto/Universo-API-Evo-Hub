import { describe, expect, it } from 'vitest';
import { calculateAvailableSpendCap } from './metaAdsInsightsService';

describe('calculateAvailableSpendCap', () => {
  it('calcula o limite restante sem usar o investimento do período', () => {
    expect(calculateAvailableSpendCap(100000, 35000)).toBe(65000);
  });

  it('não retorna saldo disponível quando a Meta não fornece spend cap ou gasto acumulado', () => {
    expect(calculateAvailableSpendCap(null, 35000)).toBeNull();
    expect(calculateAvailableSpendCap(100000, null)).toBeNull();
  });

  it('não permite limite restante negativo', () => {
    expect(calculateAvailableSpendCap(100000, 140000)).toBe(0);
  });
});
