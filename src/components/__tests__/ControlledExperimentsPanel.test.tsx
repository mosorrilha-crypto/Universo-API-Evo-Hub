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
        experimentResults={{}}
        loadingExperimentResultId={null}
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
        onLoadResult={() => undefined}
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


  it('renderiza métricas redigidas antes/depois com ressalva de decisão humana', () => {
    const html = renderToStaticMarkup(
      <ControlledExperimentsPanel
        loading={false}
        isSubmitting={false}
        transitioningExperimentId={null}
        loadingExperimentResultId={null}
        mandatoryStops={[]}
        testingReviews={[{ id: 'review-a', tenant_id: 'tenant-a', kind: 'ai_suggestion', status: 'testing', title: 'Teste de clareza', description: 'Item em teste.', context: {}, created_at: '2026-08-22T10:00:00.000Z', updated_at: '2026-08-22T10:00:00.000Z' }] as any}
        experiments={[{ id: 'experiment-a', quality_review_id: 'review-a', status: 'running', hypothesis: 'Hipótese de clareza', variation_summary: 'Resumo', scope_routes: ['faq'], sample_limit: 10, success_criteria: ['Menos correções'], stop_conditions: [], outcome_summary: null, decision_note: null, started_at: '2026-08-22T12:00:00.000Z', ended_at: null, created_at: '2026-08-22T10:00:00.000Z', updated_at: '2026-08-22T12:00:00.000Z' }] as any}
        experimentResults={{
          'experiment-a': {
            experimentId: 'experiment-a', availability: 'available', baselineStart: '2026-08-22T10:00:00.000Z', baselineEnd: '2026-08-22T12:00:00.000Z', observationStart: '2026-08-22T12:00:00.000Z', observationEnd: '2026-08-22T14:00:00.000Z', windowHours: 2,
            metrics: [{ key: 'human_corrections', label: 'Correções humanas', before: 4, after: 2, delta: -2, interpretation: 'improved' }],
            limitations: ['Leitura agregada; não prova causalidade.'],
          },
        } as any}
        onCreate={() => undefined}
        onTransition={() => undefined}
        onLoadResult={() => undefined}
      />,
    );

    expect(html).toContain('Evidências antes/depois');
    expect(html).toContain('Correções humanas');
    expect(html).toContain('Sinal favorável');
    expect(html).toContain('Leitura agregada; não prova causalidade.');
    expect(html).toContain('não prova causalidade nem publicação automática');
  });
