// @vitest-environment jsdom
/**
 * TASK-0328 tinha tirado idioma/tema da linha mobile do cabeçalho (foram pra
 * dentro da gaveta "Ferramentas" do Atendimento). TASK-0331 eliminou também
 * o menu "⋮" que morava ali (Crescimento/Configurar/Empresas/Empresa
 * ativa/Sair/Notificações), deixando a linha mobile só com o logo.
 *
 * TASK-0358 (pedido direto, print anotado) reverte parte disso: Idioma/Tema
 * voltam pro cabeçalho mobile (mesmo lugar de sempre no desktop), e o
 * seletor de empresa ("Empresa ativa"/"Sair", que tinha ido pra dentro de
 * Ferramentas na TASK-0331) volta como um ícone circular no cabeçalho —
 * mesmo espírito do seletor de conta do Claude Code. Achado real no meio
 * da mesma tarefa (print anotado, "o que é isso, coloca dentro do icon de
 * empresa"): a primeira versão tinha deixado "Sair" como um ícone SOLTO ao
 * lado do avatar — corrigido pra "Sair" viver dentro do menu que o próprio
 * avatar abre (junto da lista de empresas, quando há uma pra mostrar), sem
 * botão próprio na barra. O menu "⋮" propriamente dito (Crescimento/
 * Configurar/Empresas/Notificações) continua eliminado — esse conteúdo
 * segue dentro de Ferramentas.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const secondTenant: Tenant = { ...activeTenant, id: 'tenant-outro', name: 'Outra Empresa' };

const operator: UserProfile = {
  id: 'operator-monique',
  tenantId: activeTenant.id,
  name: 'Monique (Teste)',
  email: 'monique@example.com',
  role: 'operator',
  avatar: 'https://example.com/avatar.png',
  department: 'Operações',
};

const saasAdmin: UserProfile = { ...operator, id: 'saas-admin', role: 'saas_admin', name: 'Admin SaaS' };

const capabilities: TenantNavigationCapabilities = {
  conversations: true,
  crm: true,
  agenda: true,
  financial: true,
  growth: true,
  agent: true,
  catalog: true,
  quality: true,
  systemLogs: true,
  broadcast: true,
};

afterEach(() => {
  cleanup();
  // Sem isso, o clique no toggle de idioma do primeiro teste persiste
  // 'es' em localStorage (AppPreferencesContext) e vaza pro próximo teste.
  try {
    localStorage.clear();
  } catch {
    // sem storage disponível no ambiente de teste — segue sem estado persistido.
  }
});

describe('Header — Idioma/Tema/Empresa de volta na linha mobile (TASK-0358)', () => {
  it('operador (não saas_admin): avatar abre um menu só com "Sair", sem lista de empresas', async () => {
    const onLogout = vi.fn();
    render(
      <AppPreferencesProvider>
        <Header
          activeTab="whatsapp"
          setActiveTab={vi.fn()}
          savedCount={0}
          currentUser={operator}
          onOpenLoginModal={vi.fn()}
          onLogout={onLogout}
          tenants={[activeTenant]}
          activeTenant={activeTenant}
          onSelectTenant={vi.fn()}
          capabilities={capabilities}
          onOpenChangePasswordModal={vi.fn()}
        />
      </AppPreferencesProvider>
    );

    // Sem o menu aberto, "Sair" não deve existir solto na barra (achado
    // real corrigido nesta mesma tarefa — era um ícone à parte antes).
    expect(screen.queryByText('Sair')).toBeNull();

    const avatarButtons = screen.getAllByTitle(operator.name);
    await act(async () => {
      fireEvent.click(avatarButtons[0]);
    });

    // Sem tenants pra trocar (só 1 na lista) e sem ser saas_admin, o menu
    // não mostra "Empresa ativa" nem "Trocar operador" — só "Sair".
    expect(screen.queryByText('Empresa ativa')).toBeNull();
    const logoutButtons = screen.getAllByText('Sair');
    expect(logoutButtons.length).toBeGreaterThan(0);
    fireEvent.click(logoutButtons[0]);
    expect(onLogout).toHaveBeenCalled();

    // Botão único de idioma (mostra o idioma PRA TROCAR — "ES" enquanto PT
    // está ativo por padrão), não os dois PT/ES lado a lado do desktop.
    const langToggle = screen.getByTitle('Español');
    fireEvent.click(langToggle);
    expect(document.documentElement.lang).toBe('es-PY');
    expect(screen.getByTitle('Português')).not.toBeNull();
  });

  it('saas_admin: avatar abre a lista de empresas e "Sair" junto, no mesmo menu', async () => {
    const onSelectTenant = vi.fn();
    const onLogout = vi.fn();
    render(
      <AppPreferencesProvider>
        <Header
          activeTab="whatsapp"
          setActiveTab={vi.fn()}
          savedCount={0}
          currentUser={saasAdmin}
          onOpenLoginModal={vi.fn()}
          onLogout={onLogout}
          tenants={[activeTenant, secondTenant]}
          activeTenant={activeTenant}
          onSelectTenant={onSelectTenant}
          capabilities={capabilities}
          onOpenChangePasswordModal={vi.fn()}
        />
      </AppPreferencesProvider>
    );

    const triggers = screen.getAllByTitle(`Empresa ativa: ${activeTenant.name}`);
    await act(async () => {
      fireEvent.click(triggers[0]);
    });

    const tenantOptions = await screen.findAllByText(secondTenant.name);
    await act(async () => {
      fireEvent.click(tenantOptions[0]);
    });
    expect(onSelectTenant).toHaveBeenCalledWith(secondTenant);

    // Menu fecha ao escolher — reabre pra confirmar que "Sair" mora no
    // mesmo lugar (achado real corrigido nesta tarefa).
    await act(async () => {
      fireEvent.click(triggers[0]);
    });
    const logoutButtons = await screen.findAllByText('Sair');
    fireEvent.click(logoutButtons[0]);
    expect(onLogout).toHaveBeenCalled();
  });
});
