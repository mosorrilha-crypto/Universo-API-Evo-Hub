import { describe, expect, it } from 'vitest';
import { evolutionMessageId, evolutionProviderMessageId } from '../evolutionMessageId';

describe('identidade interna Evolution', () => {
  it('separa componentes ambíguos e recupera o ID original', () => {
    const first = evolutionMessageId('a:b', 'c/d');
    expect(first).not.toBe(evolutionMessageId('a', 'b:c/d'));
    expect(evolutionProviderMessageId('a:b', first)).toBe('c/d');
  });
  it('mantém citações do histórico legado', () => {
    expect(evolutionProviderMessageId('lucas', 'A57E8CF')).toBe('A57E8CF');
  });
});
