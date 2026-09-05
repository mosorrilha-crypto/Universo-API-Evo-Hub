import { describe, expect, it } from 'vitest';
import { isPlausiblePersonalName } from '../contactNameGuard';

describe('isPlausiblePersonalName', () => {
  it('aceita nomes de verdade, inclusive compostos, acentuados ou em caixa alta', () => {
    expect(isPlausiblePersonalName('Ana')).toBe(true);
    expect(isPlausiblePersonalName('ANA BALBUENA')).toBe(true);
    expect(isPlausiblePersonalName('María José Núñez')).toBe(true);
  });

  it('rejeita status de perfil comuns que não são nome', () => {
    expect(isPlausiblePersonalName('Ocupado')).toBe(false);
    expect(isPlausiblePersonalName('Disponible')).toBe(false);
    expect(isPlausiblePersonalName('No molestar')).toBe(false);
  });

  it('rejeita nome de negócio no lugar do nome de pessoa', () => {
    expect(isPlausiblePersonalName('Estudio de Belleza Karen')).toBe(false);
  });

  it('rejeita valores sem nenhuma letra (emoji/símbolos/números puros)', () => {
    expect(isPlausiblePersonalName('🌼')).toBe(false);
    expect(isPlausiblePersonalName('123456')).toBe(false);
    expect(isPlausiblePersonalName('...')).toBe(false);
  });

  it('rejeita vazio/undefined/null', () => {
    expect(isPlausiblePersonalName('')).toBe(false);
    expect(isPlausiblePersonalName('   ')).toBe(false);
    expect(isPlausiblePersonalName(undefined)).toBe(false);
    expect(isPlausiblePersonalName(null)).toBe(false);
  });

  it('rejeita frases longas demais pra ser um nome', () => {
    expect(isPlausiblePersonalName('Aqui é a Karen do estúdio de cílios, qualquer coisa me chama')).toBe(false);
  });
});
