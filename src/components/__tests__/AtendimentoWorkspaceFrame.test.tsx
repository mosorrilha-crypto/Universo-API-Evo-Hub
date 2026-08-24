import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
