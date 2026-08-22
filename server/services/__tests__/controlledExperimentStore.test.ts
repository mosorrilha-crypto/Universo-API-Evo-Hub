import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createControlledExperiment, getMandatoryStopConditions, listControlledExperiments, transitionControlledExperiment } from '../controlledExperimentStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const baseInput = {
  qualityReviewId: 'review-a',
  hypothesis: 'Uma orientação mais clara pode reduzir correções de nome.',
  variationSummary: 'Avaliar somente a clareza da orientação dentro de um protocolo manual, sem publicar prompt.',
  scopeRoutes: ['faq'],
  sampleLimit: 10,
  successCriteria: ['Reduzir correções humanas de nome sem elevar escalonamentos.'],
  stopConditions: [...getMandatoryStopConditions()],
  createdBy: 'admin-a',
};

beforeEach(() => initDb(createFakeSupabase()));

describe('controlledExperimentStore', () => {
  it('cria um experimento de rascunho limitado e isolado por tenant', async () => {
    const created = await createControlledExperiment({ tenantId: TENANT_A, ...baseInput });
    await createControlledExperiment({ tenantId: TENANT_B, ...baseInput, qualityReviewId: 'review-b', sampleLimit: 5 });

    expect(created).toMatchObject({ status: 'draft', sample_limit: 10, scope_routes: ['faq'] });
    expect(await listControlledExperiments(TENANT_A)).toHaveLength(1);
    expect(await listControlledExperiments(TENANT_B)).toHaveLength(1);
  });

  it('exige condições de parada duras e bloqueia rota de agendamento', async () => {
    await expect(createControlledExperiment({
      tenantId: TENANT_A,
      ...baseInput,
      stopConditions: ['Apenas uma condição livre'],
    })).rejects.toThrow('condições de parada obrigatórias');

    await expect(createControlledExperiment({
      tenantId: TENANT_A,
      ...baseInput,
      scopeRoutes: ['agendamento'],
    })).rejects.toThrow('Selecione ao menos uma rota permitida');
  });

  it('permite somente transições supervisionadas e mantém a execução reversível', async () => {
    const created = await createControlledExperiment({ tenantId: TENANT_A, ...baseInput });
    const ready = await transitionControlledExperiment({ tenantId: TENANT_A, experimentId: created.id, status: 'ready', actorId: 'admin-a', decisionNote: 'Desenho revisado.' });
    const running = await transitionControlledExperiment({ tenantId: TENANT_A, experimentId: created.id, status: 'running', actorId: 'admin-a', decisionNote: 'Início registrado; sem ativação automática.' });
    const paused = await transitionControlledExperiment({ tenantId: TENANT_A, experimentId: created.id, status: 'paused', actorId: 'admin-a', decisionNote: 'Pausa preventiva.' });

    expect(ready?.status).toBe('ready');
    expect(running?.status).toBe('running');
    expect(running?.started_at).toBeTruthy();
    expect(paused?.status).toBe('paused');
    await expect(transitionControlledExperiment({ tenantId: TENANT_A, experimentId: created.id, status: 'published' as any, actorId: 'admin-a' })).rejects.toThrow('Status de experimento inválido');

    const crossTenant = await transitionControlledExperiment({ tenantId: TENANT_B, experimentId: created.id, status: 'ready', actorId: 'admin-b' });
    expect(crossTenant).toBeNull();
  });
});
