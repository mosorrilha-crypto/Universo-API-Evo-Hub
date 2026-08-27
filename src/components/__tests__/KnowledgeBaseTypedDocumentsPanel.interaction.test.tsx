// @vitest-environment jsdom
/** PR3/#96 — fluxos administrativos deliberados: salvar rascunho e confirmar publicação. */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listKnowledgeBaseDocumentStates: vi.fn(),
  saveKnowledgeBaseDocumentDraft: vi.fn(),
  publishKnowledgeBaseDocument: vi.fn(),
  listKnowledgeBaseDocumentEvents: vi.fn(),
}));

vi.mock('../../lib/knowledgeBaseDocuments', () => ({
  ...api,
  KNOWLEDGE_BASE_DOCUMENT_TYPES: [
    'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
    'opening_hours', 'faq', 'human_handoff_rules', 'media_assets',
  ],
}));

const { KnowledgeBaseTypedDocumentsPanel } = await import('../KnowledgeBaseTypedDocumentsPanel');

const emptyStates = [
  'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
  'opening_hours', 'faq', 'human_handoff_rules', 'media_assets',
].map((documentType) => ({ documentType, published: null, draft: null }));

function statesWithProfile(draft = false) {
  return emptyStates.map((state) => state.documentType === 'business_profile' ? {
    ...state,
    published: { id: 'profile-v1', tenantId: 'tenant-a', documentType: 'business_profile', version: 1, status: 'published', data: { companyName: 'Empresa original' }, publishedAt: '2026-08-26T10:00:00.000Z' },
    draft: draft ? { id: 'profile-v2', tenantId: 'tenant-a', documentType: 'business_profile', version: 2, status: 'draft', data: { companyName: 'Empresa revisada' }, updatedAt: '2026-08-26T11:00:00.000Z' } : null,
  } : state);
}

beforeEach(() => {
  api.listKnowledgeBaseDocumentStates.mockReset();
  api.saveKnowledgeBaseDocumentDraft.mockReset();
  api.publishKnowledgeBaseDocument.mockReset();
  api.listKnowledgeBaseDocumentEvents.mockReset();
  api.listKnowledgeBaseDocumentStates.mockResolvedValue(statesWithProfile(false));
  api.listKnowledgeBaseDocumentEvents.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('KnowledgeBaseTypedDocumentsPanel — fluxos administrativos', () => {
  it('salva conteúdo revisado como rascunho, mantendo a publicação apresentada como versão vigente', async () => {
    const user = userEvent.setup();
    api.saveKnowledgeBaseDocumentDraft.mockResolvedValue({ id: 'profile-v2', status: 'draft' });
    api.listKnowledgeBaseDocumentStates.mockResolvedValueOnce(statesWithProfile(false)).mockResolvedValueOnce(statesWithProfile(true));
    render(<KnowledgeBaseTypedDocumentsPanel activeTenantId="tenant-a" />);

    await screen.findByText('Versão 1');
    const editor = screen.getByLabelText('Conteúdo estruturado do rascunho');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('Empresa original'));
    fireEvent.change(editor, { target: { value: '{\n  "companyName": "Empresa revisada"\n}' } });
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(api.saveKnowledgeBaseDocumentDraft).toHaveBeenCalledWith('business_profile', { companyName: 'Empresa revisada' }));
    expect(screen.getByText('Em produção')).not.toBeNull();
    expect(screen.getByText('Rascunho')).not.toBeNull();
  });

  it('exige confirmação explícita antes de publicar e só chama a API após confirmar', async () => {
    const user = userEvent.setup();
    api.listKnowledgeBaseDocumentStates.mockResolvedValue(statesWithProfile(true));
    api.publishKnowledgeBaseDocument.mockResolvedValue({ id: 'profile-v2', status: 'published' });
    render(<KnowledgeBaseTypedDocumentsPanel activeTenantId="tenant-a" />);

    await screen.findByText('Versão 2');
    const publishButton = screen.getByRole('button', { name: 'Publicar rascunho' });
    await user.click(publishButton);
    expect(screen.getByRole('dialog', { name: 'Publicar Perfil do negócio?' })).not.toBeNull();
    expect(api.publishKnowledgeBaseDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.publishKnowledgeBaseDocument).not.toHaveBeenCalled();
    await user.click(publishButton);
    await user.click(screen.getByRole('button', { name: 'Confirmar publicação' }));
    await waitFor(() => expect(api.publishKnowledgeBaseDocument).toHaveBeenCalledWith('business_profile'));
  });
});
