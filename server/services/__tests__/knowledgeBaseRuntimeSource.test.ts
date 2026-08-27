/**
 * PR4/#96 — o runtime só aceita a publicação completa, exclui rascunhos e
 * relê o banco a cada chamada para uma publicação valer na próxima resposta.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { getRuntimeKnowledgeBase, KNOWLEDGE_BASE_DOCUMENT_TYPES } from '../knowledgeBaseStore';
import { createFakeSupabase } from './fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function publishedDocuments(tenantId: string, companyName: string) {
  const dataByType: Record<string, Record<string, unknown>> = {
    business_profile: { companyName, agentGoal: `Atender ${companyName}`, businessModel: 'Serviços locais', locationMapsUrl: 'https://maps.example.test' },
    brand_voice: { toneOfVoice: 'Claro, respeitoso e direto' },
    service_catalog: { products: [{ name: 'Serviço publicado', price: 'R$ 100', priceAmount: 100, durationMinutes: 60, variants: [{ code: 'Especial', price: 'R$ 150', priceAmount: 150, durationMinutes: 90, whatsappMessage: 'Olá' }] }] },
    pricing_policies: { pricingAndPolicies: 'Pagamento por Pix.', businessRules: ['Nunca invente preços.'] },
    opening_hours: {},
    faq: { faqs: [{ question: 'Qual o valor?', answer: 'R$ 100.' }] },
    human_handoff_rules: {},
    media_assets: { documents: [{ id: 'doc-1', fileName: 'catalogo.pdf', fileSize: '1 MB', uploadDate: '2026-08-27', status: 'Processado' }], firstContactBlocks: [{ id: 'block-1', type: 'text', text: 'Olá!' }] },
  };
  return KNOWLEDGE_BASE_DOCUMENT_TYPES.map((documentType, index) => ({
    id: `${tenantId}-${documentType}-v1`,
    tenant_id: tenantId,
    document_type: documentType,
    version: 1,
    status: 'published',
    data: dataByType[documentType],
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
    published_at: `2026-08-27T00:0${index}:00.000Z`,
  }));
}

afterEach(() => initDb(null));

describe('getRuntimeKnowledgeBase', () => {
  it('compõe exclusivamente os oito documentos publicados e preserva catálogo, variantes, preços, mídia e FAQ', async () => {
    const supabase = createFakeSupabase({
      knowledge_base: [{ tenant_id: TENANT_A, data: { companyName: 'Legado que não deve vencer' } }],
      knowledge_base_documents: [
        ...publishedDocuments(TENANT_A, 'Empresa publicada'),
        { ...publishedDocuments(TENANT_A, 'Ignorar rascunho')[0], id: 'draft-profile', version: 2, status: 'draft', data: { companyName: 'Empresa em rascunho' } },
        { ...publishedDocuments(TENANT_A, 'Ignorar histórico')[1], id: 'archived-voice', version: 0, status: 'archived', data: { toneOfVoice: 'Tom arquivado' } },
      ],
    });
    initDb(supabase as any);

    const result = await getRuntimeKnowledgeBase(TENANT_A);

    expect(result.source).toBe('published_documents');
    expect(result.knowledgeBase).toMatchObject({
      companyName: 'Empresa publicada',
      toneOfVoice: 'Claro, respeitoso e direto',
      pricingAndPolicies: 'Pagamento por Pix.',
      businessRules: ['Nunca invente preços.'],
      faqs: [{ question: 'Qual o valor?', answer: 'R$ 100.' }],
    });
    expect(result.knowledgeBase?.products?.[0]).toMatchObject({
      name: 'Serviço publicado', priceAmount: 100, durationMinutes: 60,
      variants: [{ code: 'Especial', priceAmount: 150, durationMinutes: 90, whatsappMessage: 'Olá' }],
    });
    expect(result.knowledgeBase?.firstContactBlocks).toEqual([{ id: 'block-1', type: 'text', text: 'Olá!' }]);
  });

  it('recusa uma publicação incompleta e retorna ao blob legado sem expor rascunho ao agente', async () => {
    const supabase = createFakeSupabase({
      knowledge_base: [{ tenant_id: TENANT_A, data: { companyName: 'Base legado segura', products: [{ name: 'Legado', price: 'R$ 90' }] } }],
      knowledge_base_documents: publishedDocuments(TENANT_A, 'Incompleta').slice(0, 7),
    });
    initDb(supabase as any);

    await expect(getRuntimeKnowledgeBase(TENANT_A)).resolves.toEqual({
      knowledgeBase: { companyName: 'Base legado segura', products: [{ name: 'Legado', price: 'R$ 90' }] },
      source: 'legacy_blob',
      fallbackReason: 'published_documents_incomplete',
    });
  });

  it('relê a publicação no próximo carregamento em vez de fixar a versão no processo ou na conversa', async () => {
    const documents = publishedDocuments(TENANT_A, 'Versão 1');
    const supabase = createFakeSupabase({ knowledge_base_documents: documents });
    initDb(supabase as any);

    expect((await getRuntimeKnowledgeBase(TENANT_A)).knowledgeBase?.companyName).toBe('Versão 1');
    documents.find((document) => document.document_type === 'business_profile')!.data = { companyName: 'Versão 2 publicada' };
    expect((await getRuntimeKnowledgeBase(TENANT_A)).knowledgeBase?.companyName).toBe('Versão 2 publicada');
  });

  it('mantém tenant A e tenant B isolados na composição de runtime', async () => {
    const supabase = createFakeSupabase({
      knowledge_base_documents: [...publishedDocuments(TENANT_A, 'Empresa A'), ...publishedDocuments(TENANT_B, 'Empresa B')],
    });
    initDb(supabase as any);

    const [tenantA, tenantB] = await Promise.all([getRuntimeKnowledgeBase(TENANT_A), getRuntimeKnowledgeBase(TENANT_B)]);
    expect(tenantA.knowledgeBase?.companyName).toBe('Empresa A');
    expect(tenantB.knowledgeBase?.companyName).toBe('Empresa B');
    expect(JSON.stringify(tenantA.knowledgeBase)).not.toContain('Empresa B');
  });
});
