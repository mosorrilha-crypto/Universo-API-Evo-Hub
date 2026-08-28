/**
 * Achado real (26/08/2026, pedido do dono do produto): "Rascunho pendente"
 * aparecia no card, mas não tinha como auditar O QUE mudaria ao publicar —
 * o formulário só mostra uma versão por vez. describeKnowledgeBaseDocumentDiff
 * é o que alimenta o comparativo "Publicado vs. Rascunho" na tela.
 */
import { describe, expect, it } from 'vitest';
import { describeKnowledgeBaseDocumentDiff } from '../knowledgeBaseDocumentDiff';

describe('describeKnowledgeBaseDocumentDiff', () => {
  it('não acusa diferença quando publicado e rascunho são idênticos', () => {
    const data = { companyName: 'Studio X', agentGoal: 'Atender', businessModel: '', locationMapsUrl: '' };
    expect(describeKnowledgeBaseDocumentDiff('business_profile', data, { ...data })).toEqual([]);
  });

  it('detecta campo de texto alterado em business_profile', () => {
    const entries = describeKnowledgeBaseDocumentDiff(
      'business_profile',
      { companyName: 'Studio Antigo', agentGoal: '', businessModel: '', locationMapsUrl: '' },
      { companyName: 'Studio Novo', agentGoal: '', businessModel: '', locationMapsUrl: '' },
    );
    expect(entries).toEqual([{ label: 'Nome da empresa', before: 'Studio Antigo', after: 'Studio Novo' }]);
  });

  it('detecta preço alterado, serviço novo e serviço removido no catálogo', () => {
    const published = {
      products: [
        { id: 'p1', name: 'Corte', price: 'Gs 80.000', priceAmount: 80000 },
        { id: 'p2', name: 'Escova', price: 'Gs 50.000', priceAmount: 50000 },
      ],
    };
    const draft = {
      products: [
        { id: 'p1', name: 'Corte', price: 'Gs 95.000', priceAmount: 95000 },
        { id: 'p3', name: 'Hidratação', price: 'Gs 60.000', priceAmount: 60000 },
      ],
    };
    const entries = describeKnowledgeBaseDocumentDiff('service_catalog', published, draft);

    expect(entries).toContainEqual({ label: 'Corte — preço', before: 'Gs 80.000', after: 'Gs 95.000' });
    expect(entries).toContainEqual({ label: 'Corte — valor', before: '80.000', after: '95.000' });
    expect(entries).toContainEqual({ label: 'Serviço novo — Hidratação', before: '(novo)', after: 'Hidratação — Gs 60.000' });
    expect(entries).toContainEqual({ label: 'Serviço removido — Escova', before: 'Escova — Gs 50.000', after: '(removido)' });
  });

  it('detecta regra de negócio adicionada e removida sem contar reordenação como mudança', () => {
    const published = { pricingAndPolicies: '', businessRules: ['Regra A', 'Regra B'] };
    const draft = { pricingAndPolicies: '', businessRules: ['Regra B', 'Regra C'] };
    const entries = describeKnowledgeBaseDocumentDiff('pricing_policies', published, draft);

    expect(entries).toContainEqual({ label: 'Regra de negócio — nova', before: '(novo)', after: 'Regra C' });
    expect(entries).toContainEqual({ label: 'Regra de negócio — removida', before: 'Regra A', after: '(removido)' });
    expect(entries).toHaveLength(2);
  });

  it('detecta pergunta e resposta de FAQ alteradas separadamente', () => {
    const published = { faqs: [{ id: 'f1', question: 'Aceita cartão?', answer: 'Não.' }] };
    const draft = { faqs: [{ id: 'f1', question: 'Aceita cartão?', answer: 'Sim, à vista.' }] };
    const entries = describeKnowledgeBaseDocumentDiff('faq', published, draft);

    expect(entries).toEqual([{ label: 'Resposta — Aceita cartão?', before: 'Não.', after: 'Sim, à vista.' }]);
  });

  it('resume anexos e blocos de primeiro contato por contagem', () => {
    const entries = describeKnowledgeBaseDocumentDiff(
      'media_assets',
      { documents: [{ id: 'd1' }], firstContactBlocks: [] },
      { documents: [{ id: 'd1' }, { id: 'd2' }], firstContactBlocks: [{ id: 'b1' }] },
    );
    expect(entries).toEqual([
      { label: 'Documentos anexados', before: '1 item(ns)', after: '2 item(ns)' },
      { label: 'Blocos de primeiro contato', before: '0 item(ns)', after: '1 item(ns)' },
    ]);
  });
});
