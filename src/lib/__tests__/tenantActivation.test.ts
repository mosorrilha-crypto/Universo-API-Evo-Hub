import { describe, expect, it } from 'vitest';
import type { AgentKnowledgeBase, Tenant } from '../../types';
import { evaluateTenantActivation } from '../tenantActivation';

const connectedTenant: Pick<Tenant, 'whatsappStatus'> = { whatsappStatus: 'conectado' };

const operationalKnowledgeBase: AgentKnowledgeBase = {
  companyName: 'Studio Universo',
  agentGoal: 'Converter conversas em agendamentos confirmados.',
  toneOfVoice: 'Acolhedor e objetivo.',
  businessModel: 'Studio de beleza com atendimento agendado.',
  pricingAndPolicies: 'Atendimento mediante agendamento e confirmação de pagamento.',
  products: [
    {
      id: 'lash-lift',
      name: 'Lash Lift',
      category: 'Cílios',
      description: 'Curvatura e tratamento para cílios naturais.',
      price: 'R$ 180',
      priceAmount: 180,
      durationMinutes: 90,
    },
  ],
  businessRules: [],
  faqs: [],
  documents: [],
};

describe('evaluateTenantActivation', () => {
  it('declara o tenant pronto quando conexão, contexto, agenda e catálogo são verificáveis', () => {
    const status = evaluateTenantActivation(connectedTenant, operationalKnowledgeBase, {
      '1': { open: '09:00', close: '18:00' },
    });

    expect(status.isOperationallyReady).toBe(true);
    expect(status.blockingSteps).toBe(0);
    expect(status.completedSteps).toBe(3);
    expect(status.steps.find((step) => step.id === 'controlled_test')).toMatchObject({
      completed: false,
      blocking: false,
    });
  });

  it('não libera um tenant desconectado e sem configuração mínima', () => {
    const status = evaluateTenantActivation(
      { whatsappStatus: 'desconectado' },
      {
        ...operationalKnowledgeBase,
        companyName: '',
        agentGoal: '',
        toneOfVoice: '',
        businessModel: '',
        pricingAndPolicies: '',
        products: [],
      },
      {},
    );

    expect(status.isOperationallyReady).toBe(false);
    expect(status.blockingSteps).toBe(3);
    expect(status.steps.filter((step) => step.blocking && !step.completed).map((step) => step.id)).toEqual([
      'whatsapp',
      'business_context',
      'schedule_and_catalog',
    ]);
  });

  it('mantém a agenda bloqueada quando um serviço agendável não tem duração ou preço estruturado', () => {
    const status = evaluateTenantActivation(connectedTenant, {
      ...operationalKnowledgeBase,
      products: [
        {
          ...operationalKnowledgeBase.products[0],
          priceAmount: undefined,
          durationMinutes: undefined,
        },
      ],
    }, {
      '1': { open: '09:00', close: '18:00' },
    });

    expect(status.isOperationallyReady).toBe(false);
    expect(status.steps.find((step) => step.id === 'schedule_and_catalog')).toMatchObject({ completed: false, blocking: true });
  });
});
