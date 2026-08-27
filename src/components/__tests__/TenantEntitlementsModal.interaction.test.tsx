// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../lib/apiClient', () => api);

const { TenantEntitlementsModal } = await import('../TenantEntitlementsModal');

const catalogResponse = {
  ok: true,
  json: async () => ({ plans: [{ id: 'plan-1', key: 'professional', name: 'Profissional', version: 1, status: 'active' }] }),
};

function entitlementResponse(enabled: boolean) {
  return {
    ok: true,
    json: async () => ({
      subscription: { id: 'subscription-1', status: 'active', startedAt: '2026-08-01T00:00:00.000Z', plan: { id: 'plan-1', key: 'professional', name: 'Profissional', version: 1 } },
      entitlements: [{
        featureId: 'feature-instagram', key: 'channel.instagram', name: 'Canal Instagram', domain: 'channel', kind: 'boolean', enabled,
        limitValue: null, usage: 0, remaining: null, source: enabled ? 'plan' : 'override',
        override: enabled ? null : { id: 'override-1', reason: 'Teste de bloqueio', expiresAt: null },
      }],
    }),
  };
}

beforeEach(() => {
  let saved = false;
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/admin/entitlements/catalog') return catalogResponse;
    if (url === '/api/admin/tenants/tenant-a/entitlements') return entitlementResponse(!saved);
    if (url === '/api/admin/tenants/tenant-a/feature-overrides' && options?.method === 'POST') {
      saved = true;
      return { ok: true, json: async () => ({ id: 'override-1' }) };
    }
    throw new Error(`Chamada inesperada: ${url}`);
  });
});

afterEach(() => cleanup());

describe('TenantEntitlementsModal — controles por funcionalidade', () => {
  it('abre a caixa no próprio card ao acionar a chave e só persiste depois de salvar com motivo', async () => {
    const user = userEvent.setup();
    render(<TenantEntitlementsModal tenant={{ id: 'tenant-a', name: 'Empresa teste' }} onClose={vi.fn()} />);

    await screen.findByText('Canal Instagram');
    await user.click(screen.getByRole('switch', { name: 'Bloquear Canal Instagram' }));

    expect(api.apiFetch).not.toHaveBeenCalledWith('/api/admin/tenants/tenant-a/feature-overrides', expect.anything());
    expect(screen.getByText('Bloquear este recurso')).not.toBeNull();
    expect(screen.getByText('Alteração pendente: informe o motivo e salve para torná-la efetiva.')).not.toBeNull();

    await user.type(screen.getByLabelText('Motivo obrigatório para salvar'), 'Suspensão administrativa de teste');
    await user.click(screen.getByRole('button', { name: 'Salvar alteração' }));

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant-a/feature-overrides',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ featureId: 'feature-instagram', enabled: false, reason: 'Suspensão administrativa de teste' }),
      }),
    ));
    await screen.findByText('Canal Instagram: alteração salva e confirmada no servidor.');
    expect(screen.getByRole('switch', { name: 'Liberar Canal Instagram' })).not.toBeNull();
  });

  it('mantém o bloqueio explicitamente destacado no card recarregado', async () => {
    const user = userEvent.setup();
    render(<TenantEntitlementsModal tenant={{ id: 'tenant-a', name: 'Empresa teste' }} onClose={vi.fn()} />);

    await screen.findByText('Canal Instagram');
    await user.click(screen.getByRole('switch', { name: 'Bloquear Canal Instagram' }));
    await user.type(screen.getByLabelText('Motivo obrigatório para salvar'), 'Bloqueio temporário');
    await user.click(screen.getByRole('button', { name: 'Salvar alteração' }));

    await screen.findByText('Canal Instagram: alteração salva e confirmada no servidor.');
    const blockedButton = screen.getByRole('switch', { name: 'Liberar Canal Instagram' });
    expect(blockedButton.className).toContain('bg-rose-600');
    expect(blockedButton.textContent).toContain('Bloqueado');
  });
});
