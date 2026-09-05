import { describe, expect, it } from 'vitest';
import { isPlausiblePersonalName } from '../contactNameGuard';

describe('isPlausiblePersonalName', () => {
  it('aceita nomes de verdade, inclusive compostos, acentuados, hifenizados ou em caixa alta', () => {
    expect(isPlausiblePersonalName('Ana')).toBe(true);
    expect(isPlausiblePersonalName('ANA BALBUENA')).toBe(true);
    expect(isPlausiblePersonalName('María José Núñez')).toBe(true);
    expect(isPlausiblePersonalName('Jean-Paul')).toBe(true);
  });

  it('TASK-0310: aceita "Pao Fretes" — achado real (05/09/2026): a cliente confirmou "Paola Fretes me llamo" na conversa, era o nome dela de verdade, não uma empresa como se supôs na TASK-0305', () => {
    expect(isPlausiblePersonalName('Pao Fretes')).toBe(true);
    expect(isPlausiblePersonalName('Paola Fretes')).toBe(true);
  });

  it('rejeita status de perfil comuns que não são nome', () => {
    expect(isPlausiblePersonalName('Ocupado')).toBe(false);
    expect(isPlausiblePersonalName('Disponible')).toBe(false);
    expect(isPlausiblePersonalName('No molestar')).toBe(false);
    expect(isPlausiblePersonalName('WhatsApp Business')).toBe(false);
  });

  it('rejeita nome de negócio no lugar do nome de pessoa', () => {
    expect(isPlausiblePersonalName('Estudio de Belleza Karen')).toBe(false);
  });

  it('rejeita frases (pontuação de frase, muitas palavras, ou conectivo em minúsculo no meio)', () => {
    expect(isPlausiblePersonalName('Aqui é a Karen do estúdio de cílios, qualquer coisa me chama')).toBe(false);
    expect(isPlausiblePersonalName('Cinco Palavras Aqui Sim Mesmo')).toBe(false);
    expect(isPlausiblePersonalName('Uma frase qualquer')).toBe(false);
  });

  it('rejeita palavra com dígito', () => {
    expect(isPlausiblePersonalName('Ana123')).toBe(false);
    expect(isPlausiblePersonalName('Cliente 42')).toBe(false);
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
