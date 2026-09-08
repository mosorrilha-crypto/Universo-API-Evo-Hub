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
 * mesmo espírito do seletor de conta do Claude Code — ao lado de um ícone
 * de saída próprio. O menu "⋮" propriamente dito (Crescimento/Configurar/
 * Empresas/Notificações) continua eliminado — esse conteúdo segue dentro
 * de Ferramentas.
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
  it('mostra idioma (PT/ES), tema, o ícone circular de empresa e "Sair" na linha mobile', () => {
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

    // Ícone circular do operador (não saas_admin) — abre o modal de login
    // ao tocar, não um dropdown de troca de empresa.
    const avatarButtons = screen.getAllByTitle(operator.name);
    expect(avatarButtons.length).toBeGreaterThan(0);

    const logoutButtons = screen.getAllByTitle('Sair');
    expect(logoutButtons.length).toBeGreaterThan(0);

    // Botão único de idioma (mostra o idioma PRA TROCAR — "ES" enquanto PT
    // está ativo por padrão), não os dois PT/ES lado a lado do desktop.
    // Verificado por último porque troca o idioma real via contexto,
    // mudando a tradução do resto do cabeçalho (inclusive "Sair"→"Salir").
    const langToggle = screen.getByTitle('Español');
    fireEvent.click(langToggle);
    expect(document.documentElement.lang).toBe('es-PY');
    expect(screen.getByTitle('Português')).not.toBeNull();

    fireEvent.click(screen.getAllByTitle('Salir')[0]);
    expect(onLogout).toHaveBeenCalled();
  });

  it('saas_admin: tocar no ícone circular abre a lista de empresas', async () => {
    const onSelectTenant = vi.fn();
    render(
      <AppPreferencesProvider>
        <Header
          activeTab="whatsapp"
          setActiveTab={vi.fn()}
          savedCount={0}
          currentUser={saasAdmin}
          onOpenLoginModal={vi.fn()}
          onLogout={vi.fn()}
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
  });
});
