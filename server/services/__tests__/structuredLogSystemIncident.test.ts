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

  // TASK-0196 — achado real (CLAUDE.md): o esgotamento do crédito pré-pago
  // do Gemini já aconteceu mais de uma vez em produção, derrubando TODAS as
  // chamadas Gemini do projeto ao mesmo tempo — antes deste fix, caía como
  // incidente 'medium' genérico, indistinguível de qualquer erro isolado.
  it('classifica esgotamento de cota/crédito do Gemini como crítico, distinto de erro genérico do mesmo op', () => {
    const incident = getSystemIncidentFromStructuredLog({
      tenantId: 'tenant-a', area: 'autoReply', op: 'router', outcome: 'error',
      detail: '429 RESOURCE_EXHAUSTED: Your prepayment credits are depleted',
    });
    expect(incident).toMatchObject({
      severity: 'critical',
      category: 'integration',
      title: 'Cota/crédito pré-pago do Gemini esgotado',
      sourceKey: 'system:autoReply:router:gemini-quota-exhausted',
    });
    expect(incident?.suggestedAction).toContain('ai.studio/projects');
  });

  it('reconhece variações de texto de exaustão de cota (quota exceeded) e não confunde com erro genérico do mesmo op', () => {
    const exhausted = getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'ai', op: 'analyze-conversation', outcome: 'error', detail: 'You exceeded your current quota, please check your plan' });
    const generic = getSystemIncidentFromStructuredLog({ tenantId: 'tenant-a', area: 'ai', op: 'analyze-conversation', outcome: 'error', detail: 'timeout de rede' });
    expect(exhausted?.severity).toBe('critical');
    expect(exhausted?.sourceKey).toBe('system:ai:analyze-conversation:gemini-quota-exhausted');
    expect(generic?.severity).toBe('medium');
    expect(generic?.sourceKey).toBe('system:ai:analyze-conversation:error');
  });
});
