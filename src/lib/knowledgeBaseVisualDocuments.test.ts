import { describe, expect, it } from 'vitest';
import type { AgentKnowledgeBase } from '../types';
import type { KnowledgeBaseDocumentState } from './knowledgeBaseDocuments';
import { composeVisualKnowledgeBaseFromDocuments, splitVisualKnowledgeBaseIntoDocuments } from './knowledgeBaseVisualDocuments';

const visualKnowledgeBase: AgentKnowledgeBase = {
  companyName: 'Estúdio Aurora',
  agentGoal: 'Orientar clientes sem inventar condições.',
  businessModel: 'Atendimento especializado.',
  locationMapsUrl: 'https://maps.example/aurora',
  toneOfVoice: 'Próximo e claro.',
  pricingAndPolicies: 'Sinal mediante confirmação.',
  businessRules: ['Não confirmar pagamento automaticamente.'],
  products: [{
    id: 'servico-lash', name: 'Pestañas', price: 'Gs 140.000', description: 'Tratamento principal.', priceAmount: 140000, currency: 'PYG', durationMinutes: 90,
    variants: [{ code: 'Lash Lift', price: 'Gs 140.000', description: 'Curva natural.', durationMinutes: 90, exampleVideoId: 'video-lash' }],
    exampleImageBase64: 'data:image/png;base64,abc', beforeAfter: [{ id: 'antes-depois-1', beforeImageBase64: 'before', afterImageBase64: 'after' }],
  }],
  faqs: [{ id: 'faq-1', question: 'Quanto custa?', answer: 'Gs 140.000.' }],
  documents: [{ id: 'doc-1', fileName: 'cuidados.pdf', fileSize: '1 MB', uploadDate: '10:00', status: 'Processado' }],
  firstContactBlocks: [{ id: 'bloco-1', type: 'video', videoId: 'video-boas-vindas', videoFileName: 'boas-vindas.mp4' }],
};

describe('documentos visuais da Base de Conhecimento', () => {
  it('separa cada campo visual no documento tipado correto sem perder variantes ou mídias', () => {
    const documents = splitVisualKnowledgeBaseIntoDocuments(visualKnowledgeBase);

    expect(documents.business_profile).toMatchObject({ companyName: 'Estúdio Aurora', locationMapsUrl: 'https://maps.example/aurora' });
    expect(documents.brand_voice).toEqual({ toneOfVoice: 'Próximo e claro.' });
    expect(documents.service_catalog.products).toEqual(visualKnowledgeBase.products);
    expect(documents.pricing_policies).toEqual({ pricingAndPolicies: 'Sinal mediante confirmação.', businessRules: ['Não confirmar pagamento automaticamente.'] });
    expect(documents.faq.faqs).toEqual(visualKnowledgeBase.faqs);
    expect(documents.media_assets).toEqual({ documents: visualKnowledgeBase.documents, firstContactBlocks: visualKnowledgeBase.firstContactBlocks });
  });

  it('reconstitui o formulário pela versão tipada e prefere rascunho pendente quando ele existe', () => {
    const documents = splitVisualKnowledgeBaseIntoDocuments(visualKnowledgeBase);
    const states = Object.entries(documents).map(([documentType, data]) => {
      const typedDocumentType = documentType as KnowledgeBaseDocumentState['documentType'];
      return {
        documentType: typedDocumentType,
        published: { id: `publicado-${documentType}`, tenantId: 'tenant-a', documentType: typedDocumentType, version: 1, status: 'published' as const, data },
        draft: documentType === 'service_catalog'
          ? { id: 'rascunho-catalogo', tenantId: 'tenant-a', documentType: 'service_catalog' as const, version: 2, status: 'draft' as const, data: { products: [{ ...visualKnowledgeBase.products[0], name: 'Pestañas revisadas' }] } }
          : null,
      };
    }) as KnowledgeBaseDocumentState[];

    const result = composeVisualKnowledgeBaseFromDocuments(states);

    expect(result.companyName).toBe('Estúdio Aurora');
    expect(result.products[0].name).toBe('Pestañas revisadas');
    expect(result.products[0].variants?.[0].exampleVideoId).toBe('video-lash');
    expect(result.documents[0].fileName).toBe('cuidados.pdf');
    expect(result.firstContactBlocks?.[0].videoId).toBe('video-boas-vindas');
  });
});
