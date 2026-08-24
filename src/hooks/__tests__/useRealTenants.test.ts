// @vitest-environment jsdom
/**
 * Achado real em produção (24/08/2026): a tela "Tenants & Conexões" e os
 * botões de conexão (WhatsApp QR, CAPI, Instagram) mantinham 4 cópias
 * independentes da lista de tenants — criar/editar/excluir só atualizava a
 * cópia de quem agiu, exigindo F5 pra refletir nas outras. Este hook
 * substitui isso por um único store compartilhado; estes testes travam
 * exatamente o comportamento que corrige o bug: dois consumidores
 * independentes leem o MESMO estado, e um `refetchRealTenants()` chamado
 * por qualquer um atualiza todos.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('useRealTenants', () => {
  it('dois consumidores independentes compartilham a mesma lista', async () => {
    const { apiFetch } = await import('../../lib/apiClient');
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ tenants: [{ id: 't1', name: 'Tenant Um', slug: null, segment: null, currency: 'PYG', locale: 'es-PY', created_at: '2026-08-24T00:00:00Z', whatsappConnected: false }] }),
    } as Response);
    const { useRealTenants } = await import('../useRealTenants');

    const a = renderHook(() => useRealTenants());
    const b = renderHook(() => useRealTenants());

    await waitFor(() => expect(a.result.current.realTenants).toHaveLength(1));
    expect(b.result.current.realTenants).toEqual(a.result.current.realTenants);
    expect(a.result.current.realTenants[0].name).toBe('Tenant Um');
  });

  it('refetchRealTenants chamado por UM consumidor atualiza TODOS os outros montados (sem precisar de F5)', async () => {
    const { apiFetch } = await import('../../lib/apiClient');
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => ({ tenants: [] }) } as Response);
    const { useRealTenants } = await import('../useRealTenants');

    const a = renderHook(() => useRealTenants());
    const b = renderHook(() => useRealTenants());
    await waitFor(() => expect(a.result.current.isLoadingRealTenants).toBe(false));
    expect(a.result.current.realTenants).toHaveLength(0);
    expect(b.result.current.realTenants).toHaveLength(0);

    // Simula um tenant novo aparecendo no backend (ex: criado pelo consumidor A).
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ tenants: [{ id: 't2', name: 'Tenant Novo', slug: null, segment: null, currency: 'PYG', locale: 'es-PY', created_at: '2026-08-24T00:00:00Z', whatsappConnected: false }] }),
    } as Response);

    await act(async () => {
      await a.result.current.refetchRealTenants();
    });

    expect(a.result.current.realTenants).toHaveLength(1);
    // O consumidor B nunca chamou refetch sozinho — mas como é o MESMO
    // store compartilhado, ele reflete a atualização de A automaticamente.
    expect(b.result.current.realTenants).toHaveLength(1);
    expect(b.result.current.realTenants[0].name).toBe('Tenant Novo');
  });

  it('falha de rede não quebra o hook e mantém a lista anterior', async () => {
    const { apiFetch } = await import('../../lib/apiClient');
    vi.mocked(apiFetch).mockRejectedValue(new Error('network down'));
    const { useRealTenants } = await import('../useRealTenants');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useRealTenants());
    await waitFor(() => expect(result.current.isLoadingRealTenants).toBe(false));

    expect(result.current.realTenants).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
