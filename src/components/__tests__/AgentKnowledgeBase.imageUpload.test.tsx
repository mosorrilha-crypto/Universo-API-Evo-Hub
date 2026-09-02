/**
 * TASK-0218: fluxo real de upload de foto de produto no editor da Base de
 * Conhecimento — antes disso, selecionar um arquivo virava direto um
 * `exampleImageBase64` local (FileReader + formData, nunca uma chamada de
 * rede). Agora sobe pro Storage (POST /api/knowledge-base/images) e só a
 * referência (exampleImageId) fica no formData — mesmo padrão já validado
 * pra vídeo (handleProductVideoUpload). Cobre o caso mais crítico (produto):
 * variante/antes-depois/bloco de 1º contato reaproveitam a mesma lógica.
 */
// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => api);

const { AgentKnowledgeBaseView, emptyKnowledgeBase } = await import('../AgentKnowledgeBase');

function makeFile(name: string, type: string, content = 'fake-image-bytes'): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  api.apiFetch.mockReset();
});

afterEach(() => cleanup());

describe('AgentKnowledgeBase — upload real de foto de produto (TASK-0218)', () => {
  it('sobe a foto pro Storage (POST /api/knowledge-base/images) e mostra "Trocar foto" com a referência salva, nunca Base64', async () => {
    api.apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/knowledge-base/images' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        expect(body.mimeType).toBe('image/png');
        expect(body.fileName).toBe('foto.png');
        return { ok: true, json: async () => ({ imageId: 'image-storage-1', mimeType: 'image/png', fileName: 'foto.png', sizeBytes: 123 }) };
      }
      if (url.startsWith('/api/knowledge-base/images/')) {
        return { ok: true, blob: async () => new Blob(['fake'], { type: 'image/png' }) };
      }
      throw new Error(`Chamada inesperada: ${url}`);
    });

    const user = userEvent.setup();
    const knowledgeBase = {
      ...emptyKnowledgeBase,
      products: [{ id: 'prod-1', name: 'Microlips', price: 'Gs 500.000', description: '' }],
    };

    render(
      <AgentKnowledgeBaseView
        knowledgeBase={knowledgeBase}
        onSaveKnowledgeBase={vi.fn(async () => true)}
        businessHours={{}}
        onSaveBusinessHours={vi.fn(async () => true)}
        onGoToWhatsAppSim={vi.fn()}
      />
    );

    // Abre a seção 3 (Preços & Produtos), fechada por padrão.
    await user.click(screen.getByRole('button', { name: /Preços & Produtos/ }));
    // Seleciona o produto na lista à esquerda pra abrir o painel de edição.
    await user.click(await screen.findByText('Microlips'));

    const fileInput = (await screen.findByText('Adicionar foto de exemplo')).closest('label')!.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile('foto.png', 'image/png'));

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/api/knowledge-base/images', expect.objectContaining({ method: 'POST' })));
    await screen.findByText('Trocar foto');
    expect(screen.queryByText('Adicionar foto de exemplo')).toBeNull();
  });

  it('mostra erro e não altera o produto quando o upload falha (ex: formato rejeitado pelo servidor)', async () => {
    api.apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/knowledge-base/images' && options?.method === 'POST') {
        return { ok: false, status: 400, json: async () => ({ error: 'Formato de imagem não aceito.' }) };
      }
      throw new Error(`Chamada inesperada: ${url}`);
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const user = userEvent.setup();
    const knowledgeBase = {
      ...emptyKnowledgeBase,
      products: [{ id: 'prod-1', name: 'Microlips', price: 'Gs 500.000', description: '' }],
    };

    render(
      <AgentKnowledgeBaseView
        knowledgeBase={knowledgeBase}
        onSaveKnowledgeBase={vi.fn(async () => true)}
        businessHours={{}}
        onSaveBusinessHours={vi.fn(async () => true)}
        onGoToWhatsAppSim={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Preços & Produtos/ }));
    await user.click(await screen.findByText('Microlips'));

    const fileInput = (await screen.findByText('Adicionar foto de exemplo')).closest('label')!.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile('foto.gif', 'image/gif'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Formato de imagem não aceito.')));
    expect(screen.getByText('Adicionar foto de exemplo')).not.toBeNull();
    alertSpy.mockRestore();
  });

  it('rejeita arquivo maior que 5MB no próprio navegador, sem chamar a API', async () => {
    // Outro useEffect do componente busca /api/tenant-prompt-layer no mount,
    // sem relação com este teste — resposta genérica ok evita ruído.
    api.apiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    const knowledgeBase = {
      ...emptyKnowledgeBase,
      products: [{ id: 'prod-1', name: 'Microlips', price: 'Gs 500.000', description: '' }],
    };

    render(
      <AgentKnowledgeBaseView
        knowledgeBase={knowledgeBase}
        onSaveKnowledgeBase={vi.fn(async () => true)}
        businessHours={{}}
        onSaveBusinessHours={vi.fn(async () => true)}
        onGoToWhatsAppSim={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Preços & Produtos/ }));
    await user.click(await screen.findByText('Microlips'));

    const bigFile = makeFile('foto.png', 'image/png', 'x'.repeat(6 * 1024 * 1024));
    const fileInput = (await screen.findByText('Adicionar foto de exemplo')).closest('label')!.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, bigFile);

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('5MB'));
    expect(api.apiFetch).not.toHaveBeenCalledWith('/api/knowledge-base/images', expect.anything());
    alertSpy.mockRestore();
  });
});
