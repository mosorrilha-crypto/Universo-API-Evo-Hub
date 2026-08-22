import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContactContextPanel } from '../ContactContextPanel';
import type { ContactAgentContext } from '../../types';

const context: ContactAgentContext = {
  available: true,
  unavailable: { memory: false, trace: false },
  memory: {
    preferredLanguage: 'es-PY',
    preferredName: 'Ana',
    currentIntent: 'agendamento',
    serviceInterest: 'Extensões de cílios',
    objections: ['Dúvida sobre duração'],
    openLoops: [{ kind: 'payment', summary: 'Comprovante aguardando verificação humana.', status: 'awaiting_human' }],
    nextBestAction: 'Aguardar a decisão do operador sobre o comprovante.',
    conversationSummary: 'Cliente demonstrou interesse.',
    updatedAt: '2026-08-22T10:05:00.000Z',
    updatedBy: 'system',
  },
  latestDecision: {
    createdAt: '2026-08-22T10:05:00.000Z',
    routerDecision: 'agendamento',
    reasoningSummary: 'Roteado para agendamento; gate humano ativo.',
    contextPackVersion: 'contact-context-v1',
    // A UI só deve usar sinais conhecidos e não transformar fatos arbitrários
    // redigidos em conteúdo visível ao operador.
    selectedFacts: { paymentStatus: 'pending_verification', internalSecret: 'NUNCA_RENDERIZAR' },
    toolSummaries: ['Disponibilidade consultada.'],
    needsHumanConfirmation: true,
    outcome: 'human_confirmation_required',
  },
};

describe('ContactContextPanel', () => {
  it('apresenta a revisão humana e esconde fatos arbitrários do trace', () => {
    const html = renderToStaticMarkup(
      <ContactContextPanel context={context} isLoading={false} variant="detail" />,
    );

    expect(html).toContain('Revisão humana');
    expect(html).toContain('Comprovante em verificação humana');
    expect(html).toContain('Aguardar a decisão do operador sobre o comprovante.');
    expect(html).toContain('Disponibilidade consultada.');
    expect(html).not.toContain('NUNCA_RENDERIZAR');
  });

  it('mantém uma mensagem segura quando a fonte de contexto está indisponível', () => {
    const html = renderToStaticMarkup(
      <ContactContextPanel context={{ ...context, available: false, unavailable: { memory: true, trace: true }, memory: null, latestDecision: null }} isLoading={false} variant="compact" />,
    );

    expect(html).toContain('As proteções humanas continuam ativas.');
  });
});
