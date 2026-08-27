/** PR3/#96 — cliente HTTP para estados, rascunhos, publicação e auditoria. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('./apiClient', () => ({ apiFetch }));

const {
  listKnowledgeBaseDocumentEvents,
  listKnowledgeBaseDocumentStates,
  publishKnowledgeBaseDocument,
  saveKnowledgeBaseDocumentDraft,
  KnowledgeBaseDocumentsApiError,
} = await import('./knowledgeBaseDocuments');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('knowledgeBaseDocuments API client', () => {
  beforeEach(() => apiFetch.mockReset());

  it('lista os estados tipados no endpoint administrativo tenant-scoped', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ documents: [{ documentType: 'brand_voice', published: { id: 'pub-1' }, draft: null }] }));

    await expect(listKnowledgeBaseDocumentStates()).resolves.toEqual([{ documentType: 'brand_voice', published: { id: 'pub-1' }, draft: null }]);
    expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-base/documents');
  });

  it('envia o payload de rascunho somente sob data, sem tenant_id controlável pelo cliente', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ document: { id: 'draft-2', documentType: 'brand_voice', status: 'draft' } }));

    await saveKnowledgeBaseDocumentDraft('brand_voice', { toneOfVoice: 'Claro e respeitoso' });
    expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-base/documents/brand_voice/draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { toneOfVoice: 'Claro e respeitoso' } }),
    });
  });

  it('publica e consulta o histórico no tipo selecionado', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ document: { id: 'pub-2', status: 'published' } }));
    apiFetch.mockResolvedValueOnce(jsonResponse({ events: [{ id: 'event-1', eventType: 'published' }] }));

    await expect(publishKnowledgeBaseDocument('faq')).resolves.toMatchObject({ id: 'pub-2', status: 'published' });
    await expect(listKnowledgeBaseDocumentEvents('faq')).resolves.toEqual([{ id: 'event-1', eventType: 'published' }]);
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/knowledge-base/documents/faq/publish',
      '/api/knowledge-base/documents/faq/events',
    ]);
  });

  it('propaga uma mensagem tratável do servidor em vez de ocultar falhas de RBAC ou validação', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ error: 'Permissão insuficiente pra essa ação.' }, 403));

    await expect(publishKnowledgeBaseDocument('faq')).rejects.toEqual(new KnowledgeBaseDocumentsApiError('Permissão insuficiente pra essa ação.', 403));
  });
});
