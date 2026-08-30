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
import type { TenantNavigationCapabilities } from '../../lib/tenantCapabilities';

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

const fullyEnabledCapabilities: TenantNavigationCapabilities = {
  conversations: true,
  crm: true,
  agenda: true,
  financial: true,
  growth: true,
  agent: true,
  catalog: true,
  quality: true,
  systemLogs: true,
};

function renderHeader(
  capabilities: TenantNavigationCapabilities = fullyEnabledCapabilities,
  currentUser: UserProfile = saasAdmin,
) {
  return render(
    <AppPreferencesProvider>
      <Header
        activeTab="whatsapp"
        setActiveTab={vi.fn()}
        savedCount={0}
        currentUser={currentUser}
        onOpenLoginModal={vi.fn()}
        onLogout={vi.fn()}
        tenants={[activeTenant]}
        activeTenant={activeTenant}
        onSelectTenant={vi.fn()}
        capabilities={capabilities}
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
  it('oculta exclusivamente Financeiro sem ocultar Agenda quando o módulo não foi liberado', () => {
    renderHeader({ ...fullyEnabledCapabilities, financial: false });

    expect(screen.getByRole('button', { name: 'Agenda' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Financeiro' })).toBeNull();
  });

  // Achado real, 30/08/2026 (pedido direto do dono do produto): o teste
  // acima ("mantém todos os recursos visíveis ao SaaS Admin...") validava
  // exatamente o bug de um commit anterior ("fix: preserva acesso do saas
  // admin aos recursos", 27/08/2026) — o SaaS Admin passou a ignorar as
  // capacidades da empresa ativa e via tudo sempre, quebrando a função de
  // pré-visualizar uma empresa (ex: Clic Piscinas, só 6 recursos
  // liberados, aparecia com todos). Removido; ver App.tsx/Header.tsx pro
  // revert completo. O SaaS Admin continua vendo Logs do Sistema sempre
  // (comportamento intencional à parte, não afetado por este revert).

  it('remove todos os menus correspondentes às capacidades bloqueadas da empresa ativa', async () => {
    const user = userEvent.setup();
    renderHeader({
      ...fullyEnabledCapabilities,
      agenda: false,
      financial: false,
      growth: false,
      catalog: false,
      quality: false,
      systemLogs: false,
    }, { ...saasAdmin, role: 'admin' });

    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Financeiro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crescimento' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Configurar' }));
    const menu = screen.getByRole('menu', { name: 'Configurar' });
    expect(within(menu).queryByRole('menuitem', { name: 'Catálogo público' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Qualidade do agente' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Logs do sistema' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Agente & catálogo' })).not.toBeNull();
  });

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
      'Logs do sistema',
    ]);
  });

  it('mostra Empresas como item direto e exclusivo do SaaS Admin', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Empresas' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Plataforma' })).toBeNull();
  });

  it('mantém Logs do Sistema disponível ao SaaS Admin antes da liberação para a empresa', async () => {
    const user = userEvent.setup();
    renderHeader({ ...fullyEnabledCapabilities, systemLogs: false });
    await user.click(screen.getByRole('button', { name: 'Configurar' }));
    expect(within(screen.getByRole('menu', { name: 'Configurar' })).getByRole('menuitem', { name: 'Logs do sistema' })).not.toBeNull();
  });

  it('não mostra Empresas para o administrador interno de um tenant', () => {
    renderHeader(fullyEnabledCapabilities, {
      ...saasAdmin,
      id: 'admin-clic',
      tenantId: 'tenant-clic',
      email: 'admin@clic.example',
      role: 'admin',
    });

    expect(screen.queryByRole('button', { name: 'Empresas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plataforma' })).toBeNull();
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
