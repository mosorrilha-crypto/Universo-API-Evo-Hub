import { describe, expect, it } from 'vitest';
import { isPlausiblePersonalName } from '../contactNameGuard';

describe('isPlausiblePersonalName', () => {
  it('TASK-0305: sempre retorna false — o nome de perfil do WhatsApp nunca mais é usado pra chamar a cliente, nem quando parece claramente um nome de pessoa', () => {
    expect(isPlausiblePersonalName('Ana')).toBe(false);
    expect(isPlausiblePersonalName('ANA BALBUENA')).toBe(false);
    expect(isPlausiblePersonalName('María José Núñez')).toBe(false);
  });

  it('continua false pros casos que já eram rejeitados antes (status, nome de negócio, vazio, sem letra)', () => {
    expect(isPlausiblePersonalName('Ocupado')).toBe(false);
    expect(isPlausiblePersonalName('Estudio de Belleza Karen')).toBe(false);
    expect(isPlausiblePersonalName('Pao Fretes')).toBe(false);
    expect(isPlausiblePersonalName('🌼')).toBe(false);
    expect(isPlausiblePersonalName('')).toBe(false);
    expect(isPlausiblePersonalName(undefined)).toBe(false);
    expect(isPlausiblePersonalName(null)).toBe(false);
  });
});
