import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFailedLogins, isLoginLocked, recordFailedLogin, resetAuthLoginAttemptsForTests } from '../authLoginAttempts';

describe('authLoginAttempts', () => {
  beforeEach(() => {
    resetAuthLoginAttemptsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não bloqueia uma conta sem falhas registradas', () => {
    expect(isLoginLocked('alguem@example.com')).toBe(false);
  });

  it('não bloqueia antes do limite de falhas', () => {
    for (let i = 0; i < 4; i += 1) recordFailedLogin('alguem@example.com');
    expect(isLoginLocked('alguem@example.com')).toBe(false);
  });

  it('bloqueia a conta ao atingir o limite de falhas na janela', () => {
    for (let i = 0; i < 5; i += 1) recordFailedLogin('alguem@example.com');
    expect(isLoginLocked('alguem@example.com')).toBe(true);
  });

  it('é case-insensitive e ignora espaços — mesma conta, grafias diferentes', () => {
    for (let i = 0; i < 5; i += 1) recordFailedLogin('Alguem@Example.com ');
    expect(isLoginLocked(' alguem@example.com')).toBe(true);
  });

  it('login bem-sucedido zera o histórico de falhas da conta', () => {
    for (let i = 0; i < 4; i += 1) recordFailedLogin('alguem@example.com');
    clearFailedLogins('alguem@example.com');
    recordFailedLogin('alguem@example.com');
    expect(isLoginLocked('alguem@example.com')).toBe(false);
  });

  it('não afeta o contador de uma conta diferente', () => {
    for (let i = 0; i < 5; i += 1) recordFailedLogin('vitima@example.com');
    expect(isLoginLocked('outra-conta@example.com')).toBe(false);
  });

  it('a janela expira — falhas antigas não contam pra sempre', () => {
    for (let i = 0; i < 5; i += 1) recordFailedLogin('alguem@example.com');
    expect(isLoginLocked('alguem@example.com')).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(isLoginLocked('alguem@example.com')).toBe(false);
  });
});
