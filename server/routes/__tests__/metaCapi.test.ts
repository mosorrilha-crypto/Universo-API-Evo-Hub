/**
 * Epic 4.5.1 — Meta CAPI deixou de ser mock (server/routes/metaCapi.ts). Não
 * dá pra testar a chamada real à Meta sem credenciais de produção, mas o
 * hash/normalização de telefone é a parte que garante que "advanced
 * matching" bate com o que a Meta espera — trava isso aqui.
 */
import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { hashUserDataField, normalizePhoneForHash } from '../metaCapi';

describe('normalizePhoneForHash', () => {
  it('remove tudo que não é dígito', () => {
    expect(normalizePhoneForHash('+595 (981) 234-567')).toBe('595981234567');
  });
});

describe('hashUserDataField', () => {
  it('produz SHA-256 minúsculo/trimado, igual ao que a Meta calcula do lado dela', () => {
    const expected = crypto.createHash('sha256').update('595981234567').digest('hex');
    expect(hashUserDataField('  595981234567  ')).toBe(expected);
    expect(hashUserDataField('ABC')).toBe(crypto.createHash('sha256').update('abc').digest('hex'));
  });
});
