/**
 * TASK-0103 / PR2 — contrato do ciclo draft → published → archived. O agente
 * continua no blob legado; estes testes só verificam o armazenamento tipado e
 * a composição publicada que será usada no corte posterior.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  composeKnowledgeBaseDocuments,
  getPublishedKnowledgeBaseDocuments,
  listKnowledgeBaseDocumentEvents,
  listKnowledgeBaseDocumentStates,
  publishKnowledgeBaseDocument,
  saveKnowledgeBaseDocumentDraft,
  validateKnowledgeBaseDocumentData,
} from '../knowledgeBaseStore';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACTOR_A = 'operator-a';

describe('ciclo de vida de documentos tipados', () => {
  let supabase: ReturnType<typeof createFakeSupabase>;

  beforeEach(() => {
    supabase = createFakeSupabase({
      knowledge_base_documents: [
        { id: 'published-a-v1', tenant_id: TENANT_A, document_type: 'business_profile', version: 1, status: 'published', data: { companyName: 'Empresa A' } },
        { id: 'published-b-v1', tenant_id: TENANT_B, document_type: 'business_profile', version: 1, status: 'published', data: { companyName: 'Empresa B' } },
      ],
      knowledge_base_document_events: [],
    });
    initDb(supabase as any);
    supabase.__setRpcTenant(TENANT_A);
  });

  afterEach(() => initDb(null));

  it('cria e atualiza somente o rascunho com a próxima versão e eventos auditáveis', async () => {
    const created = await saveKnowledgeBaseDocumentDraft(TENANT_A, 'business_profile', { companyName: 'Empresa A revisada' }, ACTOR_A);
    const updated = await saveKnowledgeBaseDocumentDraft(TENANT_A, 'business_profile', { companyName: 'Empresa A revisada', agentGoal: 'Qualificar sem inventar dados.' }, ACTOR_A);

    expect(created).toMatchObject({ tenantId: TENANT_A, documentType: 'business_profile', version: 2, status: 'draft' });
    expect(updated).toMatchObject({ id: created.id, version: 2, status: 'draft', data: { companyName: 'Empresa A revisada', agentGoal: 'Qualificar sem inventar dados.' } });
    expect(supabase.__tables.knowledge_base_documents.find((row: any) => row.id === 'published-a-v1')).toMatchObject({ status: 'published', data: { companyName: 'Empresa A' } });
    expect(await listKnowledgeBaseDocumentEvents(TENANT_A, 'business_profile')).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'draft_updated', version: 2, actorId: ACTOR_A }),
      expect.objectContaining({ eventType: 'draft_created', version: 2, actorId: ACTOR_A }),
    ]));
  });

  it('publica o rascunho, arquiva a publicação anterior e preserva uma única publicação vigente', async () => {
    const draft = await saveKnowledgeBaseDocumentDraft(TENANT_A, 'business_profile', { companyName: 'Empresa A revisada' }, ACTOR_A);
    const published = await publishKnowledgeBaseDocument(TENANT_A, 'business_profile', ACTOR_A);

    expect(published).toMatchObject({ id: draft.id, tenantId: TENANT_A, version: 2, status: 'published' });
    expect(supabase.__tables.knowledge_base_documents.find((row: any) => row.id === 'published-a-v1')).toMatchObject({ status: 'archived' });
    expect(supabase.__tables.knowledge_base_documents.filter((row: any) => row.tenant_id === TENANT_A && row.document_type === 'business_profile' && row.status === 'published')).toHaveLength(1);
    expect(await getPublishedKnowledgeBaseDocuments(TENANT_A)).toEqual([
      expect.objectContaining({ id: draft.id, status: 'published', version: 2 }),
    ]);
    expect(composeKnowledgeBaseDocuments(await getPublishedKnowledgeBaseDocuments(TENANT_A))).toEqual({ companyName: 'Empresa A revisada' });
    expect(await listKnowledgeBaseDocumentEvents(TENANT_A, 'business_profile')).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'published', version: 2, documentId: draft.id }),
      expect.objectContaining({ eventType: 'draft_created', version: 2, documentId: draft.id }),
    ]));
  });

  it('recusa nova publicação sem rascunho e não cria uma segunda versão publicada', async () => {
    await saveKnowledgeBaseDocumentDraft(TENANT_A, 'business_profile', { companyName: 'Empresa A revisada' }, ACTOR_A);
    await publishKnowledgeBaseDocument(TENANT_A, 'business_profile', ACTOR_A);

    await expect(publishKnowledgeBaseDocument(TENANT_A, 'business_profile', ACTOR_A)).rejects.toMatchObject({ code: 'P0002' });
    expect(supabase.__tables.knowledge_base_documents.filter((row: any) => row.tenant_id === TENANT_A && row.document_type === 'business_profile' && row.status === 'published')).toHaveLength(1);
  });

  it('mantém os estados de edição do tenant A isolados do tenant B', async () => {
    await saveKnowledgeBaseDocumentDraft(TENANT_A, 'business_profile', { companyName: 'Empresa A revisada' }, ACTOR_A);
    const states = await listKnowledgeBaseDocumentStates(TENANT_A);
    const profile = states.find((state) => state.documentType === 'business_profile');

    expect(profile).toMatchObject({
      published: expect.objectContaining({ id: 'published-a-v1', tenantId: TENANT_A }),
      draft: expect.objectContaining({ tenantId: TENANT_A, version: 2 }),
    });
    expect(JSON.stringify(states)).not.toContain('Empresa B');
  });

  it('usa o tenant do contexto RPC, não a ordem dos dados semeados, ao criar o rascunho', async () => {
    supabase.__setRpcTenant(TENANT_B);
    const draft = await saveKnowledgeBaseDocumentDraft(TENANT_B, 'business_profile', { companyName: 'Empresa B revisada' }, 'operator-b');

    expect(draft).toMatchObject({ tenantId: TENANT_B, version: 2, status: 'draft' });
    expect(supabase.__tables.knowledge_base_documents.filter((row: any) => row.tenant_id === TENANT_A && row.status === 'draft')).toHaveLength(0);
  });

  it('rejeita campos fora do contrato e catálogo estruturalmente inválido antes de persistir', () => {
    expect(() => validateKnowledgeBaseDocumentData('brand_voice', { toneOfVoice: 'Direto', tenant_id: TENANT_B })).toThrow('não permitido');
    expect(() => validateKnowledgeBaseDocumentData('service_catalog', { products: [{ name: 'Sem preço' }] })).toThrow('products[0].price');
  });
});
