// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const tenantApi = vi.hoisted(() => ({ useRealTenants: vi.fn() }));

vi.mock('../../lib/apiClient', () => api);
vi.mock('../../hooks/useRealTenants', () => tenantApi);

const { SaaSAdminDashboard } = await import('../SaaSAdminDashboard');

const tenantAlpha = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Empresa Alpha',
  slug: 'empresa-alpha',
  isActive: true,
  segment: 'generic',
  currency: 'PYG',
  locale: 'es-PY',
  whatsappConnected: true,
};

const tenantBlocked = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Empresa Bloqueada',
  slug: 'empresa-bloqueada',
  isActive: false,
  segment: 'generic',
  currency: 'PYG',
  locale: 'es-PY',
  whatsappConnected: false,
};

beforeEach(() => {
  tenantApi.useRealTenants.mockReturnValue({
    realTenants: [tenantAlpha, tenantBlocked],
    isLoadingRealTenants: false,
    refetchRealTenants: vi.fn(),
  });
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/admin/operators') return { ok: true, json: async () => ({ operators: [] }) };
    throw new Error(`Chamada inesperada: ${url}`);
  });
});

afterEach(() => cleanup());

describe('SaaSAdminDashboard — acesso direto à empresa', () => {
  it('encaminha o tenant escolhido ao fluxo de entrada sem exigir credencial de operador', async () => {
    const user = userEvent.setup();
    const onEnterTenant = vi.fn();
    render(<SaaSAdminDashboard currentUser={{ id: 'saas-1', name: 'Admin SaaS', email: 'admin@teste.local', tenantId: tenantAlpha.id, role: 'saas_admin' }} onEnterTenant={onEnterTenant} />);

    await screen.findByText('Empresa Alpha');
    await user.click(screen.getByRole('button', { name: 'Acessar empresa sem senha' }));

    expect(onEnterTenant).toHaveBeenCalledTimes(1);
    expect(onEnterTenant).toHaveBeenCalledWith(expect.objectContaining({ id: tenantAlpha.id, name: tenantAlpha.name }));
  });

  it('não permite entrada direta em uma empresa bloqueada', async () => {
    render(<SaaSAdminDashboard currentUser={{ id: 'saas-1', name: 'Admin SaaS', email: 'admin@teste.local', tenantId: tenantAlpha.id, role: 'saas_admin' }} onEnterTenant={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Empresa Bloqueada')).not.toBeNull());
    const blockedButton = screen.getByRole('button', { name: 'Empresa bloqueada' }) as HTMLButtonElement;
    expect(blockedButton.disabled).toBe(true);
  });
});
