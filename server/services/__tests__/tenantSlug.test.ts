import { describe, expect, it } from 'vitest';
import { TENANT_SLUG_PATTERN, friendlyTenantSlugError, POSTGRES_UNIQUE_VIOLATION_CODE } from '../tenantSlug';

describe('TENANT_SLUG_PATTERN', () => {
  it('aceita minúsculas, números e hífen', () => {
    expect(TENANT_SLUG_PATTERN.test('monique-teste')).toBe(true);
    expect(TENANT_SLUG_PATTERN.test('clic-piscinas-2')).toBe(true);
  });

  it('rejeita espaço, acento e maiúscula', () => {
    expect(TENANT_SLUG_PATTERN.test('Pestañas por Monique')).toBe(false);
    expect(TENANT_SLUG_PATTERN.test('Monique-Teste')).toBe(false);
    expect(TENANT_SLUG_PATTERN.test('monique teste')).toBe(false);
  });
});

describe('friendlyTenantSlugError', () => {
  it('traduz violação de UNIQUE (slug duplicado) numa mensagem amigável', () => {
    expect(friendlyTenantSlugError({ code: POSTGRES_UNIQUE_VIOLATION_CODE, message: 'duplicate key value violates unique constraint "tenants_slug_key"' }))
      .toBe('Esse endereço já está em uso por outro tenant — escolha outro.');
  });

  it('deixa qualquer outro erro passar direto', () => {
    expect(friendlyTenantSlugError({ code: '42703', message: 'column does not exist' })).toBe('column does not exist');
    expect(friendlyTenantSlugError({ message: 'erro genérico sem code' })).toBe('erro genérico sem code');
  });
});
