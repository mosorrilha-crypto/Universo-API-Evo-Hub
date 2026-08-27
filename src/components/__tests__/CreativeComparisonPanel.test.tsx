// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreativeComparisonPanel } from '../CreativeComparisonPanel';

const ads = Array.from({ length: 9 }, (_, index) => ({
  id: `ad-${index + 1}`,
  name: `Criativo ${index + 1}`,
  campaignName: index === 8 ? 'Campanha especial' : 'Campanha principal',
  adSetName: index === 8 ? 'Conjunto teste' : 'Conjunto principal',
  deliveryStatus: index === 1 ? 'paused' as const : 'active' as const,
  spend: 100 + index,
  ctr: 2.4,
  messagingConversations: index + 1,
  costPerMessagingConversation: 4.5,
  qualityRanking: 'ABOVE_AVERAGE',
  engagementRateRanking: 'AVERAGE',
}));

const renderPanel = () => render(
  <CreativeComparisonPanel
    ads={ads}
    accountId="act_123"
    currency="BRL"
    locale="pt-BR"
    language="pt"
    money={(value) => `R$ ${value ?? '-'}`}
    number={(value) => String(value ?? '-')}
    percentage={(value) => `${value ?? '-'}%`}
    rank={(value) => value ?? '-'}
    onNotice={vi.fn()}
  />,
);

afterEach(() => cleanup());

describe('CreativeComparisonPanel', () => {
  it('usa a identidade escura do Universo e alterna as seções pelo menu interno', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Comparar criativos' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Resultados/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByText('Criativo 1').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(screen.getByPlaceholderText('Buscar criativo, conjunto ou campanha')).toBeTruthy();
    expect(screen.queryByText('Campanha especial')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Colunas/ }));
    expect(screen.getByText('Escolha quais informações aparecem na tabela.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Qualidade/ })).toBeTruthy();
  });

  it('filtra por busca, restaura resultados e pagina a lista', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /Filtros/ }));
    await user.type(screen.getByPlaceholderText('Buscar criativo, conjunto ou campanha'), 'especial');
    await user.click(screen.getByRole('button', { name: /Resultados/ }));
    expect(screen.getAllByText('Criativo 9').length).toBeGreaterThan(0);
    expect(screen.queryByText('Criativo 1')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Filtros/ }));
    await user.click(screen.getByRole('button', { name: /Limpar/ }));
    await user.click(screen.getByRole('button', { name: /Resultados/ }));
    expect(screen.getAllByText('Criativo 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Página 1 / 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getAllByText('Criativo 9').length).toBeGreaterThan(0);
    expect(screen.getByText('Página 2 / 2')).toBeTruthy();
  });

  it('seleciona um criativo e expõe as ações sem quebrar o estado da lista', async () => {
    const user = userEvent.setup();
    renderPanel();

    const checkbox = screen.getAllByRole('checkbox', { name: 'Selecionar Criativo 1' })[0];
    await user.click(checkbox);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Abrir na Meta' }).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Ver detalhes' })[0]);
    const detail = screen.getByText('Detalhe do criativo').parentElement?.parentElement;
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByText('Criativo 1')).toBeTruthy();
  });
});
