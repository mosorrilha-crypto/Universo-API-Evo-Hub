// @vitest-environment jsdom
/**
 * Achado real (print anotado pelo dono do produto): o card de um escalonamento
 * sem responsável mostrava "Sem responsável" DUAS vezes — uma no pill de
 * status (`statusLabel('open')`) e outra no selo de "responsável atribuído/
 * sem responsável" logo abaixo, ambos vindos do mesmo estado (nenhum
 * `assignedOperatorId`). Estes testes travam que o segundo selo só aparece
 * quando ele soma informação nova ao pill (responsável atribuído, ou status
 * pendente que não seja 'open').
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EscalationsPanel } from '../EscalationsPanel';
import type { EscalationInfo } from '../../types';

afterEach(() => cleanup());

function makeEscalation(overrides: Partial<EscalationInfo> = {}): EscalationInfo {
  return {
    id: 'esc-1',
    phone: '595983612867',
    contactName: 'Belu Martin',
    reason: 'Cliente tentando fechar agendamento',
    country: 'Paraguay',
    resolved: false,
    createdAt: new Date().toISOString(),
    status: 'open',
    priority: 'medium',
    ...overrides,
  };
}

describe('EscalationsPanel — redundância de "Sem responsável"', () => {
  it('caso "open" sem responsável mostra o texto "Sem responsável" só uma vez (o pill de status)', () => {
    render(
      <EscalationsPanel
        escalations={[makeEscalation({ status: 'open' })]}
        onResolve={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getAllByText('Sem responsável')).toHaveLength(1);
  });

  it('caso "assigned" mostra "Responsável atribuído", nunca "Sem responsável"', () => {
    render(
      <EscalationsPanel
        escalations={[makeEscalation({ status: 'assigned', assignedOperatorId: 'op-1' })]}
        onResolve={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Responsável atribuído')).toBeTruthy();
    expect(screen.queryByText('Sem responsável')).toBeNull();
  });

  it('caso "awaiting_customer" sem responsável mostra o selo "Sem responsável" (não duplica o pill, que diz "Aguardando cliente")', () => {
    render(
      <EscalationsPanel
        escalations={[makeEscalation({ status: 'awaiting_customer' })]}
        onResolve={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Aguardando cliente')).toBeTruthy();
    expect(screen.getAllByText('Sem responsável')).toHaveLength(1);
  });
});
