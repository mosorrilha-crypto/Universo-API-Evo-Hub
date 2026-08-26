import { describe, expect, it } from 'vitest';
import { normalizeConversationPhone } from '../phoneNormalization';

describe('normalizeConversationPhone', () => {
  it('adiciona o nono dígito apenas para celular brasileiro legado de oito dígitos', () => {
    expect(normalizeConversationPhone('556798038466')).toBe('5567998038466');
  });

  it('mantém celular brasileiro já canônico', () => {
    expect(normalizeConversationPhone('+55 (67) 99803-8466')).toBe('5567998038466');
  });

  it('não altera linha fixa brasileira nem números de outros países', () => {
    expect(normalizeConversationPhone('556730011000')).toBe('556730011000');
    expect(normalizeConversationPhone('595981234567')).toBe('595981234567');
  });
});
