import { describe, expect, it } from 'vitest';
import { formatChatDateLabel, getChatDateParts, isNewChatDateGroup } from './chatDate';

describe('chatDate', () => {
  const now = new Date('2026-08-23T15:00:00Z');

  it('agrupa timestamp de horário legado no dia atual', () => {
    expect(getChatDateParts('14:32', now).key).toBe('2026-08-23');
    expect(formatChatDateLabel('14:32', false, now)).toBe('Hoje');
  });

  it('formata hoje e ontem no idioma selecionado', () => {
    expect(formatChatDateLabel('2026-08-23T10:00:00Z', false, now)).toBe('Hoje');
    expect(formatChatDateLabel('2026-08-22T10:00:00Z', false, now)).toBe('Ontem');
    expect(formatChatDateLabel('2026-08-22T10:00:00Z', true, now)).toBe('Ayer');
  });

  it('mantém data anterior identificável e inclui o ano quando necessário', () => {
    const parts = getChatDateParts('2026-08-20T10:00:00Z', now);
    expect(parts.key).toBe('2026-08-20');
    expect(formatChatDateLabel('2026-08-20T10:00:00Z', false, now)).toContain('20');
    expect(formatChatDateLabel('2025-08-20T10:00:00Z', false, now)).toContain('2025');
  });

  it('insere grupo apenas quando a data muda', () => {
    expect(isNewChatDateGroup('2026-08-23T10:01:00Z', '2026-08-23T10:00:00Z')).toBe(false);
    expect(isNewChatDateGroup('2026-08-22T10:00:00Z', '2026-08-23T10:00:00Z')).toBe(true);
    expect(isNewChatDateGroup('Agora mesmo', 'Agora mesmo')).toBe(false);
    expect(isNewChatDateGroup('2026-08-23T10:00:00Z', 'Agora mesmo')).toBe(true);
    expect(isNewChatDateGroup('Agora mesmo', '2026-08-23T10:00:00Z')).toBe(false);
  });

  it('não inventa uma data para timestamp inválido', () => {
    expect(getChatDateParts('Agora mesmo', now)).toEqual({ key: null, date: null });
    expect(formatChatDateLabel('Agora mesmo', false, now)).toBeNull();
  });
});
