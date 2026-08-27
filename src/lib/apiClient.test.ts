import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getAuthToken, getTenantOverride, setAuthToken, setTenantOverride, setUnauthorizedHandler } from './apiClient';

describe('apiClient tenant override', () => {
  afterEach(() => {
    setTenantOverride(null);
    setAuthToken(null);
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it('descarta IDs fictícios ou legados que não são UUIDs', () => {
    setTenantOverride('tenant_004');
    expect(getTenantOverride()).toBeNull();

    setTenantOverride('tenant-de-outra-empresa');
    expect(getTenantOverride()).toBeNull();
  });

  it('mantém um UUID de tenant válido', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
  });

  it('aceita o UUID canônico legado do Clic mesmo sem variante RFC 4122', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
  });
});

describe('apiClient sessão e autorização', () => {
  it('não encerra uma sessão válida quando a rota recusa apenas o papel do usuário', async () => {
    const onUnauthorized = vi.fn();
    setAuthToken('token-válido');
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Permissão insuficiente pra essa ação.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })));

    await apiFetch('/api/knowledge-base/documents');

    expect(getAuthToken()).toBe('token-válido');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('encerra a sessão somente quando o servidor a identifica explicitamente como inválida', async () => {
    const onUnauthorized = vi.fn();
    setAuthToken('token-expirado');
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403, headers: { 'X-Auth-Session-Invalid': 'true' } })));

    await apiFetch('/api/knowledge-base/documents');

    expect(getAuthToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
