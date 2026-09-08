// @vitest-environment jsdom
/**
 * TASK-0328 (pedido direto, print anotado do cabeçalho): seletor de idioma
 * (ES/PT) e o botão de tema saíram da linha mobile do cabeçalho — mudaram
 * pra dentro da gaveta "Ferramentas" do Atendimento (WhatsAppLeadsSim.tsx).
 * TASK-0331 (pedido direto, prints anotados): o próprio menu "⋮" (gaveta
 * com Crescimento/Configurar/Empresas/Empresa ativa/Sair/Notificações) foi
 * eliminado — todo esse conteúdo também mudou pra dentro da gaveta
 * "Ferramentas". A linha mobile do cabeçalho fica só com o logo.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

const operator: UserProfile = {
  id: 'operator-monique',
  tenantId: activeTenant.id,
  name: 'Monique (Teste)',
  email: 'monique@example.com',
  role: 'operator',
  avatar: 'https://example.com/avatar.png',
  department: 'Operações',
};

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

afterEach(() => cleanup());

describe('Header — linha mobile sem idioma/tema nem menu "⋮"', () => {
  it('não mostra os antigos seletores de idioma/tema nem o menu "⋮" na linha mobile — só o logo', () => {
    render(
      <AppPreferencesProvider>
        <Header
          activeTab="whatsapp"
          setActiveTab={vi.fn()}
          savedCount={0}
          currentUser={operator}
          onOpenLoginModal={vi.fn()}
          onLogout={vi.fn()}
          tenants={[activeTenant]}
          activeTenant={activeTenant}
          onSelectTenant={vi.fn()}
          capabilities={capabilities}
          onOpenChangePasswordModal={vi.fn()}
        />
      </AppPreferencesProvider>
    );

    expect(screen.queryByTitle('Español')).toBeNull();
    expect(screen.queryByTitle('Português')).toBeNull();
    // TASK-0331 — o menu "⋮" foi eliminado; nenhum jeito de abri-lo continua a existir.
    expect(screen.queryByTitle('Menu')).toBeNull();
    // Logo aparece 2x no DOM (linha mobile + linha desktop, ambas
    // renderizadas — só a responsividade via CSS decide qual aparece).
    expect(screen.getAllByTitle('Ir para o Atendimento').length).toBeGreaterThan(0);
  });
});
