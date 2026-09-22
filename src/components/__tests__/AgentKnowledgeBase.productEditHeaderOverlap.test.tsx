/**
 * TASK-0445 (achado real, print anotado: "estes botão estão encavalados") —
 * no mobile, a barra "Fechar" do painel "Editar produto" (dentro do fluxo
 * normal) e o grupo de ícones duplicar/excluir (posicionado `absolute top-3
 * right-3`, sem nenhuma exceção pra mobile) disputavam o mesmo canto
 * superior direito, ficando visualmente empilhados. Duplicar/excluir agora
 * entram na própria barra "Fechar" no mobile; o grupo posicionado
 * (`absolute`) vira exclusivo do desktop (`hidden lg:flex`), onde não há
 * barra nenhuma competindo por esse espaço.
 */
// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => api);

const { AgentKnowledgeBaseView, emptyKnowledgeBase } = await import('../AgentKnowledgeBase');

beforeEach(() => {
  api.apiFetch.mockReset();
});

afterEach(() => cleanup());

async function renderWithSelectedProduct() {
  // Outro useEffect do componente busca /api/tenant-prompt-layer no mount,
  // sem relação com este teste — resposta genérica ok evita ruído (mesmo
  // padrão de AgentKnowledgeBase.imageUpload.test.tsx).
  api.apiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
  const user = userEvent.setup();
  const knowledgeBase = {
    ...emptyKnowledgeBase,
    products: [{ id: 'prod-1', name: 'Microlips', price: 'Gs 500.000', description: '' }],
  };

  render(
    <AppPreferencesProvider>
      <AgentKnowledgeBaseView
        knowledgeBase={knowledgeBase}
        businessHours={{}}
        onSaveBusinessHours={vi.fn(async () => true)}
        onGoToWhatsAppSim={vi.fn()}
      />
    </AppPreferencesProvider>
  );

  await user.click(screen.getByRole('button', { name: /Preços & Produtos/ }));
  await user.click(await screen.findByText('Microlips'));
  return user;
}

describe('AgentKnowledgeBase — painel "Editar produto": duplicar/excluir não sobrepõem "Fechar" no mobile (TASK-0445)', () => {
  it('o grupo posicionado (absolute) fica oculto por padrão — exclusivo do desktop (lg:flex)', async () => {
    await renderWithSelectedProduct();

    // A lista de produtos à esquerda também tem seus próprios botões de
    // duplicar/excluir por linha — filtra só os de DENTRO do painel "Editar
    // produto" (identificado pelo rótulo "Editar produto" no cabeçalho).
    const editPanel = screen.getByText('Editar produto').closest('div.relative.group') as HTMLElement;
    const duplicateButtons = within(editPanel).getAllByTitle('Duplicar produto');
    const deleteButtons = within(editPanel).getAllByTitle('Excluir produto');
    // Um par na barra "Fechar" (mobile) + um par no grupo posicionado (desktop).
    expect(duplicateButtons).toHaveLength(2);
    expect(deleteButtons).toHaveLength(2);

    const positionedDuplicate = duplicateButtons.find((btn) => btn.closest('div.absolute'));
    const positionedGroup = positionedDuplicate!.closest('div.absolute')!;
    expect(positionedGroup.className).toContain('hidden');
    expect(positionedGroup.className).toContain('lg:flex');

    const headerDuplicate = duplicateButtons.find((btn) => !btn.closest('div.absolute'));
    expect(headerDuplicate!.closest('div.lg\\:hidden')).not.toBeNull();
  });

  it('duplicar produto pela barra "Fechar" (mobile) funciona normalmente', async () => {
    const user = await renderWithSelectedProduct();

    const editPanel = screen.getByText('Editar produto').closest('div.relative.group') as HTMLElement;
    const mobileDuplicateButton = within(editPanel).getAllByTitle('Duplicar produto').find((btn) => !btn.closest('div.absolute'))!;
    await user.click(mobileDuplicateButton);

    expect(await screen.findByText('Microlips (cópia)')).toBeTruthy();
  });

  it('excluir produto pela barra "Fechar" (mobile) funciona normalmente e fecha o painel', async () => {
    const user = await renderWithSelectedProduct();

    const editPanel = screen.getByText('Editar produto').closest('div.relative.group') as HTMLElement;
    const mobileDeleteButton = within(editPanel).getAllByTitle('Excluir produto').find((btn) => !btn.closest('div.absolute'))!;
    await user.click(mobileDeleteButton);

    expect(screen.queryByText('Microlips')).toBeNull();
  });
});
