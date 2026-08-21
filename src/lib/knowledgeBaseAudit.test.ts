import { describe, expect, it } from 'vitest';
import type { AgentKnowledgeBase } from '../types';
import { auditKnowledgeBase, productNeedsAttention } from './knowledgeBaseAudit';

const completeKb: AgentKnowledgeBase = {
  companyName: 'Empresa teste', agentGoal: 'Atender bem', toneOfVoice: 'Direto', businessModel: 'Serviços', pricingAndPolicies: 'Pagamento antes', locationMapsUrl: 'https://maps.google.com',
  products: [{ id: 'p1', name: 'Consulta', category: 'Serviços', price: 'Gs 100.000', priceAmount: 100000, description: 'Consulta inicial', durationMinutes: 60 }],
  businessRules: ['Não inventar valores'], faqs: [{ id: 'faq-1', question: 'Onde fica?', answer: 'No centro.' }], documents: [],
};

describe('auditKnowledgeBase', () => {
  it('não aponta pendências para um serviço completo e agendável', () => {
    const audit = auditKnowledgeBase(completeKb, { '1': { open: '09:00', close: '18:00' } }, new Date('2026-08-21'));
    expect(audit.actionableProductIds.size).toBe(0);
    expect(audit.totals.critical).toBe(0);
    expect(audit.totals.attention).toBe(0);
  });

  it('sinaliza campos que comprometem resposta, agendamento e financeiro', () => {
    const incomplete = { ...completeKb, products: [{ id: 'p2', name: 'Serviço novo', price: 'Gs 200.000', description: '', durationMinutes: undefined, priceAmount: undefined }], documents: [{ id: 'd1', fileName: 'catalogo.docx', fileSize: '1 MB', uploadDate: '2026-08-20', status: 'Pendente' as const }] };
    const audit = auditKnowledgeBase(incomplete, {}, new Date('2026-08-21'));
    expect(productNeedsAttention(incomplete.products[0], new Date('2026-08-21'))).toBe(true);
    expect(audit.actionableProductIds).toContain('p2');
    expect(audit.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(['catalog-p2-category', 'catalog-p2-amount', 'catalog-p2-duration', 'operation-hours', 'documents-pending']));
  });
});
