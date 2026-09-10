import { describe, expect, it } from 'vitest';
import {
  EMPTY_TENANT_NAVIGATION_CAPABILITIES,
  resolveTenantNavigationCapabilities,
} from './tenantCapabilities';

describe('resolveTenantNavigationCapabilities', () => {
  it('falha fechada quando a resposta de capacidades não está disponível', () => {
    expect(resolveTenantNavigationCapabilities(undefined)).toEqual(
      EMPTY_TENANT_NAVIGATION_CAPABILITIES,
    );
  });

  it('libera apenas os menus cujas capacidades efetivas estão habilitadas', () => {
    expect(resolveTenantNavigationCapabilities([
      { key: 'inbox.conversations', enabled: true },
      { key: 'booking.calendar', enabled: false },
      { key: 'sales.financial', enabled: false },
      { key: 'growth.meta_ads', enabled: false },
      { key: 'catalog.public_page', enabled: false },
      { key: 'quality.agent_review', enabled: false },
      { key: 'operations.system_logs', enabled: false },
      { key: 'marketing.broadcast', enabled: false },
      { key: 'ai.auto_reply', enabled: true },
      { key: 'crm.follow_ups', enabled: true },
    ])).toEqual({
      conversations: true,
      crm: true,
      agenda: false,
      financial: false,
      growth: false,
      agent: true,
      catalog: false,
      quality: false,
      systemLogs: false,
      broadcast: false,
    });
  });
});
