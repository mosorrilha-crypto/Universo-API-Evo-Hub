import { describe, expect, it } from 'vitest';
import { warmupCurveCapForDay, effectiveDailyCap, hasCompletedWarmup } from '../warmupCurve';

describe('warmupCurve', () => {
  it('segue a curva de aquecimento por patamar de progresso', () => {
    expect(warmupCurveCapForDay(0)).toBe(40);
    expect(warmupCurveCapForDay(3)).toBe(40);
    expect(warmupCurveCapForDay(4)).toBe(100);
    expect(warmupCurveCapForDay(8)).toBe(250);
    expect(warmupCurveCapForDay(15)).toBe(1000);
    expect(warmupCurveCapForDay(100)).toBe(1000);
  });

  it('effectiveDailyCap nunca ultrapassa o teto final configurado, mesmo se a curva sugerir mais', () => {
    expect(effectiveDailyCap(15, 200)).toBe(200);
    expect(effectiveDailyCap(0, 200)).toBe(40);
  });

  it('hasCompletedWarmup só é true quando o patamar da curva já alcança o teto configurado', () => {
    expect(hasCompletedWarmup(0, 200)).toBe(false);
    expect(hasCompletedWarmup(8, 200)).toBe(true); // patamar 250 >= teto 200
    expect(hasCompletedWarmup(8, 1000)).toBe(false); // patamar 250 < teto 1000
    expect(hasCompletedWarmup(15, 1000)).toBe(true);
  });
});
