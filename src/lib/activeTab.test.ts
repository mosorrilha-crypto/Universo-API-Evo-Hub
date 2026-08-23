import { describe, expect, it } from 'vitest';
import { parseStoredActiveTab } from './activeTab';

describe('parseStoredActiveTab', () => {
  it('restaura uma aba válida', () => {
    expect(parseStoredActiveTab('financial')).toBe('financial');
    expect(parseStoredActiveTab('whatsapp')).toBe('whatsapp');
  });

  it('mantém Integrações válida para acesso contextual', () => {
    expect(parseStoredActiveTab('integration')).toBe('integration');
  });

  it('usa home para valor ausente ou inválido', () => {
    expect(parseStoredActiveTab(null)).toBe('home');
    expect(parseStoredActiveTab('')).toBe('home');
    expect(parseStoredActiveTab('unknown-tab')).toBe('home');
  });
});
