import { describe, expect, it } from 'vitest';
import { parseStoredActiveTab } from './activeTab';

describe('parseStoredActiveTab', () => {
  it('restaura abas válidas independentes', () => {
    expect(parseStoredActiveTab('agenda')).toBe('agenda');
    expect(parseStoredActiveTab('financial')).toBe('financial');
    expect(parseStoredActiveTab('whatsapp')).toBe('whatsapp');
  });

  it('migra preferências de telas descontinuadas para o destino equivalente', () => {
    expect(parseStoredActiveTab('integration')).toBe('whatsapp');
    expect(parseStoredActiveTab('agenda_financeiro')).toBe('agenda');
  });

  it('usa home para valor ausente ou inválido', () => {
    expect(parseStoredActiveTab(null)).toBe('home');
    expect(parseStoredActiveTab('')).toBe('home');
    expect(parseStoredActiveTab('unknown-tab')).toBe('home');
  });
});
