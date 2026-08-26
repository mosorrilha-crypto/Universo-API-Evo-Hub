// @vitest-environment jsdom
/**
 * Direção visual: Operação Serena — a navegação empresarial precisa ser
 * previsível, acessível e permanecer visível acima do conteúdo do painel.
 */
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { Header } from '../Header';
import { Tenant, UserProfile } from '../../types';

const activeTenant: Tenant = {
  id: 'tenant-monique',
  name: 'Monique — Pestañas por Monique',
  slug: 'monique',
  plan: 'enterprise',
  monthlyMRR: 0,
  status: 'ativo',
  createdAt: '2026-08-24T00:00:00.000Z',
  whatsappPhone: '+595000000000',
  whatsappStatus: 'conectado',
  whatsappEngine: 'evolution_vps',
  maxLeadsPerMonth: 1000,
  currentLeadsMonth: 0,
  webhookEndpoint: 'https://example.com/webhook',
};

const saasAdmin: UserProfile = {
  id: 'operator-monique',
  tenantId: activeTenant.id,
  name: 'Monique (Teste)',
  email: 'monique@example.com',
  role: 'saas_admin',
  avatar: 'https://example.com/avatar.png',
  department: 'Operações',
};

function renderHeader() {
  return render(
    <AppPreferencesProvider>
      <Header
        activeTab="whatsapp"
        setActiveTab={vi.fn()}
        savedCount={0}
        currentUser={saasAdmin}
        onOpenLoginModal={vi.fn()}
        onLogout={vi.fn()}
        tenants={[activeTenant]}
        activeTenant={activeTenant}
        onSelectTenant={vi.fn()}
      />
    </AppPreferencesProvider>,
  );
}

afterEach(() => cleanup());

// Bug real reportado (25/08/2026): no iPhone em PWA (tela cheia, notch/Dynamic
// Island), o header sticky ficava colado atrás da barra de status do iOS —
// logo e botão de menu parcialmente cobertos, toque no menu não registrava.
// Fix: `style={{ paddingTop: 'env(safe-area-inset-top)' }}` no <header>.
describe('grupos de navegação no desktop', () => {
  it('agrupa a configuração do agente e o catálogo no menu Configurar', async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = screen.getByRole('button', { name: 'Configurar' });
    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Configurar' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Agente & catálogo',
      'Catálogo público',
      'Qualidade do agente',
    ]);
  });

  it('mantém a gestão multi-tenant isolada no menu Plataforma', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Plataforma' }));

    const menu = screen.getByRole('menu', { name: 'Plataforma' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Empresas']);
  });

  it('fecha Configurar com Escape e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = screen.getByRole('button', { name: 'Configurar' });
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Configurar' })).not.toBeNull();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Configurar' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
