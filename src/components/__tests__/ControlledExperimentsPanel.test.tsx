import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControlledExperimentsPanel } from '../QualityAuditCenter';

describe('ControlledExperimentsPanel', () => {
  it('renderiza protocolo limitado, reversível e sem publicação automática', () => {
    const html = renderToStaticMarkup(
      <ControlledExperimentsPanel
        loading={false}
        isSubmitting={false}
        transitioningExperimentId={null}
        mandatoryStops={[
          'Sinal de pagamento ou confirmação de agenda',
          'Escalonamento humano, incidente sensível ou risco de segurança',
          'Aumento de respostas bloqueadas, inseguras ou incorretas',
        ]}
        testingReviews={[
          { id: 'review-a', tenant_id: 'tenant-a', kind: 'ai_suggestion', status: 'testing', title: 'Teste de clareza', description: 'Item em teste.', context: {}, created_at: '2026-08-22T10:00:00.000Z', updated_at: '2026-08-22T10:00:00.000Z' },
        ] as any}
        experiments={[] as any}
        onCreate={() => undefined}
        onTransition={() => undefined}
      />,
    );

    expect(html).toContain('Teste limitado, reversível e supervisionado');
    expect(html).toContain('Paradas obrigatórias');
    expect(html).toContain('Agendamento fica fora do escopo');
    expect(html).toContain('não modifica prompt');
    expect(html).toContain('Criar rascunho controlado');
    expect(html).not.toContain('Publicar automaticamente');
  });
});
