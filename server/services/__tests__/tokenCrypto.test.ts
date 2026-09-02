import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, resetTokenCryptoKeyCacheForTests } from '../tokenCrypto';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

describe('tokenCrypto', () => {
  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    resetTokenCryptoKeyCacheForTests();
  });

  describe('com TOKEN_ENCRYPTION_KEY configurada', () => {
    beforeEach(() => {
      process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
      resetTokenCryptoKeyCacheForTests();
    });

    it('cifra e decifra o mesmo valor original', () => {
      const encrypted = encryptSecret('meu-refresh-token-secreto');
      expect(encrypted).not.toBe('meu-refresh-token-secreto');
      expect(encrypted.startsWith('v1:')).toBe(true);
      expect(decryptSecret(encrypted)).toBe('meu-refresh-token-secreto');
    });

    it('duas cifragens do mesmo valor produzem ciphertexts diferentes (IV aleatório)', () => {
      const a = encryptSecret('mesmo-valor');
      const b = encryptSecret('mesmo-valor');
      expect(a).not.toBe(b);
      expect(decryptSecret(a)).toBe('mesmo-valor');
      expect(decryptSecret(b)).toBe('mesmo-valor');
    });

    it('decifra texto puro legado (sem prefixo v1:) sem lançar — compatibilidade com dados gravados antes desta mudança', () => {
      expect(decryptSecret('token-antigo-em-texto-puro')).toBe('token-antigo-em-texto-puro');
    });

    it('rejeita ciphertext adulterado (GCM detecta a violação de integridade)', () => {
      const encrypted = encryptSecret('valor-original');
      const parts = encrypted.split(':');
      // Adultera um byte do ciphertext, mantendo o formato válido.
      const tampered = [...parts];
      tampered[3] = Buffer.from('adulterado-mesmo').toString('base64');
      expect(() => decryptSecret(tampered.join(':'))).toThrow();
    });

    it('rejeita uma chave com tamanho errado', () => {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
      resetTokenCryptoKeyCacheForTests();
      expect(() => encryptSecret('qualquer-coisa')).toThrow(/32 bytes/);
    });
  });

  describe('sem TOKEN_ENCRYPTION_KEY configurada (rollout seguro)', () => {
    beforeEach(() => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      resetTokenCryptoKeyCacheForTests();
    });

    it('encryptSecret devolve o valor original sem cifrar, nunca lança', () => {
      expect(encryptSecret('valor-qualquer')).toBe('valor-qualquer');
    });

    it('decryptSecret devolve texto puro como está', () => {
      expect(decryptSecret('valor-qualquer')).toBe('valor-qualquer');
    });

    it('decryptSecret lança se encontrar um valor cifrado (formato v1:) sem a chave pra decifrar', () => {
      process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
      resetTokenCryptoKeyCacheForTests();
      const encrypted = encryptSecret('foi-cifrado-com-a-chave');
      delete process.env.TOKEN_ENCRYPTION_KEY;
      resetTokenCryptoKeyCacheForTests();
      expect(() => decryptSecret(encrypted)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    });
  });
});
