import { describe, expect, it } from 'vitest';
import { getSystemIncidentFromStructuredLog, redactSystemIncidentDetail } from '../structuredLog';

describe('getSystemIncidentFromStructuredLog', () => {
  it('não registra operação normal como incidente', () => {
    expect(getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'autoReply', op: 'send', outcome: 'success' })).toBeNull();
  });

  it('registra uso da fonte legada como contingência auditável, sem alerta automático', () => {
    const incident = getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'knowledgeBase', op: 'loadRuntimeSource', outcome: 'success', detail: 'source=legacy_blob;reason=published_documents_incomplete' });
    expect(incident).toMatchObject({ category: 'knowledge_base', severity: 'high', sourceKey: 'system:knowledgeBase:loadRuntimeSource:legacy-fallback' });
  });

  it('converte falha estruturada em registro técnico com sugestão revisável', () => {
    const incident = getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'catalog', op: 'load', outcome: 'error', detail: 'erro temporário' });
    expect(incident?.category).toBe('catalog');
    expect(incident?.suggestedAction).toContain('Revise');
  });

  it('classifica runtime indisponível da Base como crítico e não expõe contatos ou tokens', () => {
    const incident = getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'knowledgeBase', op: 'loadRuntimeSource', outcome: 'error', detail: 'source=unavailable token=segredo telefone=+55 11 99999-9999' });
    expect(incident).toMatchObject({ severity: 'critical', title: 'Runtime da Base de Conhecimento indisponível' });
    expect(incident?.detail).not.toContain('token=segredo');
    expect(incident?.detail).not.toContain('99999');
  });

  it('redige e-mail, telefone e segredo no detalhe destinado à auditoria', () => {
    expect(redactSystemIncidentDetail('email=cliente@exemplo.com token=abc123 telefone=5511999999999')).toBe('email=[e-mail redigido] [segredo redigido] telefone=[telefone redigido]');
  });
});
