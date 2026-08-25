// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AtendimentoWorkspaceFrame from '../AtendimentoWorkspaceFrame';
import type { Tenant } from '../../types';

const makeTenant = (id: string, name: string): Tenant => ({
  id,
  name,
  slug: id,
  plan: 'enterprise',
  monthlyMRR: 0,
  status: 'ativo',
  createdAt: '2026-08-24',
  whatsappPhone: '',
  whatsappStatus: 'desconectado',
  whatsappEngine: 'meta_cloud_api',
  maxLeadsPerMonth: 0,
  currentLeadsMonth: 0,
  webhookEndpoint: '',
});

const tenants = [makeTenant('tenant-a', 'Empresa A'), makeTenant('tenant-b', 'Empresa B')];

const renderFrame = (canSwitchTenant: boolean, availableTenants = tenants) => renderToStaticMarkup(
  <AtendimentoWorkspaceFrame
    activeTenantName={availableTenants[0].name}
    activeTenant={availableTenants[0]}
    tenants={availableTenants}
    canSwitchTenant={canSwitchTenant}
    onSelectTenant={() => undefined}
    pendingCount={0}
    leadCount={0}
  >
    <div>Conteúdo</div>
  </AtendimentoWorkspaceFrame>,
);

describe('AtendimentoWorkspaceFrame — seletor de tenant', () => {
  it('exibe a seta e o contrato acessível quando há mais de uma empresa autorizada', () => {
    const html = renderFrame(true);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Trocar empresa ativa. Empresa atual: Empresa A');
    expect(html).toContain('atendimento-workspace__tenant-chevron');
    expect(html).not.toContain('Empresa B');
  });

  it('não oferece troca para perfis sem permissão ou sem outra empresa disponível', () => {
    const withoutPermission = renderFrame(false);
    const singleTenant = renderFrame(true, [tenants[0]]);

    expect(withoutPermission).not.toContain('aria-haspopup="menu"');
    expect(withoutPermission).not.toContain('atendimento-workspace__tenant-chevron');
    expect(singleTenant).not.toContain('aria-haspopup="menu"');
    expect(singleTenant).not.toContain('atendimento-workspace__tenant-chevron');
    expect(withoutPermission).toContain('Empresa A');
  });
});

describe('AtendimentoWorkspaceFrame — resumo da operação recolhível', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const renderInteractiveFrame = (pendingCount = 0) => render(
    <AtendimentoWorkspaceFrame
      activeTenantName={tenants[0].name}
      activeTenant={tenants[0]}
      tenants={tenants}
      canSwitchTenant={false}
      onSelectTenant={() => undefined}
      pendingCount={pendingCount}
      leadCount={12}
    >
      <div>Conteúdo</div>
    </AtendimentoWorkspaceFrame>,
  );

  it('achado real de UI (pedido do dono do produto, print do celular): começa recolhido por padrão, sem localStorage prévio', () => {
    renderInteractiveFrame();

    expect(screen.queryByText('conversas em acompanhamento')).toBeNull();
    expect(screen.getByRole('button', { name: /Resumo da operação/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('mostra a contagem de pendências humanas no próprio botão fechado, sem precisar expandir', () => {
    renderInteractiveFrame(3);

    expect(screen.getByRole('button', { name: /Resumo da operação · 3 pendências humanas/ })).not.toBeNull();
  });

  it('expande ao clicar, revelando os cartões de resumo, e recolhe de novo ao clicar outra vez', () => {
    renderInteractiveFrame();
    const toggle = screen.getByRole('button', { name: /Resumo da operação/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('conversas em acompanhamento')).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('conversas em acompanhamento')).toBeNull();
  });

  it('lembra a preferência de aberto entre montagens (localStorage), mesmo padrão de tema/idioma', () => {
    const { unmount } = renderInteractiveFrame();
    fireEvent.click(screen.getByRole('button', { name: /Resumo da operação/ }));
    expect(localStorage.getItem('atendimento_summary_open')).toBe('true');
    unmount();

    renderInteractiveFrame();
    expect(screen.getByRole('button', { name: /Resumo da operação/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('conversas em acompanhamento')).not.toBeNull();
  });
});
