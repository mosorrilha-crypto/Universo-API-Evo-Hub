import { describe, it, expect } from 'vitest';
import { normalizeText } from '../textNormalize';

describe('normalizeText', () => {
  it('remove acentos', () => {
    expect(normalizeText('Pestañas')).toBe('pestanas');
  });

  it('converte pra minúsculas', () => {
    expect(normalizeText('LASH LIFT')).toBe('lash lift');
  });

  it('remove espaços nas pontas e colapsa espaços internos repetidos', () => {
    expect(normalizeText('  Combo   Full Face  ')).toBe('combo full face');
  });

  it('não altera texto já normalizado', () => {
    expect(normalizeText('microlips')).toBe('microlips');
  });
});
