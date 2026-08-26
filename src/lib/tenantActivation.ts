import type { AgentKnowledgeBase, BusinessHours, Tenant } from '../types';
import { auditKnowledgeBase, type KnowledgeAudit } from './knowledgeBaseAudit';

export type TenantActivationStepId = 'whatsapp' | 'business_context' | 'schedule_and_catalog' | 'controlled_test';

export interface TenantActivationStep {
  id: TenantActivationStepId;
  title: string;
  description: string;
  completed: boolean;
  /** Uma etapa de revisão não bloqueia a ativação, mas deixa o próximo passo explícito. */
  blocking: boolean;
  destination: 'whatsapp' | 'knowledge';
  actionLabel: string;
}

export interface TenantActivationStatus {
  steps: TenantActivationStep[];
  completedSteps: number;
  blockingSteps: number;
  isOperationallyReady: boolean;
  knowledgeAudit: KnowledgeAudit;
}

/**
 * Converte fontes de verdade já existentes em um estado de ativação legível.
 * Não persiste um "concluído" manual: se uma configuração deixa de existir,
 * o tenant volta a aparecer como pendente imediatamente.
 */
export function evaluateTenantActivation(
  tenant: Pick<Tenant, 'whatsappStatus'>,
  knowledgeBase: AgentKnowledgeBase,
  businessHours: BusinessHours,
): TenantActivationStatus {
  const knowledgeAudit = auditKnowledgeBase(knowledgeBase, businessHours);
  const contextComplete = knowledgeAudit.findings.every((finding) => finding.area !== 'context' || finding.severity === 'info');
  const scheduleAndCatalogComplete = knowledgeAudit.findings.every((finding) => (
    finding.severity !== 'critical' &&
    finding.area !== 'operation' &&
    finding.area !== 'catalog'
  ));

  const steps: TenantActivationStep[] = [
    {
      id: 'whatsapp',
      title: 'Conecte o WhatsApp',
      description: tenant.whatsappStatus === 'conectado'
        ? 'Canal conectado e pronto para receber conversas.'
        : 'Conecte o número comercial para o agente receber e responder leads.',
      completed: tenant.whatsappStatus === 'conectado',
      blocking: true,
      destination: 'whatsapp',
      actionLabel: tenant.whatsappStatus === 'conectado' ? 'Ver atendimento' : 'Conectar agora',
    },
    {
      id: 'business_context',
      title: 'Apresente o negócio ao agente',
      description: contextComplete
        ? 'Objetivo, tom e políticas essenciais estão definidos.'
        : 'Defina o objetivo, o tom e as regras comerciais para respostas consistentes.',
      completed: contextComplete,
      blocking: true,
      destination: 'knowledge',
      actionLabel: contextComplete ? 'Revisar contexto' : 'Completar contexto',
    },
    {
      id: 'schedule_and_catalog',
      title: 'Configure agenda e serviços',
      description: scheduleAndCatalogComplete
        ? 'Horários, catálogo e regras de agendamento estão prontos para operar.'
        : 'Cadastre horários, serviços, preços e duração antes de liberar agendamentos.',
      completed: scheduleAndCatalogComplete,
      blocking: true,
      destination: 'knowledge',
      actionLabel: scheduleAndCatalogComplete ? 'Revisar operação' : 'Configurar operação',
    },
    {
      id: 'controlled_test',
      title: 'Faça uma conversa de teste',
      description: 'Envie uma mensagem de um número de teste e confirme a resposta, o contexto e o próximo passo sugerido.',
      completed: false,
      blocking: false,
      destination: 'whatsapp',
      actionLabel: 'Abrir atendimento',
    },
  ];

  const blockingSteps = steps.filter((step) => step.blocking && !step.completed).length;
  return {
    steps,
    completedSteps: steps.filter((step) => step.completed).length,
    blockingSteps,
    isOperationallyReady: blockingSteps === 0,
    knowledgeAudit,
  };
}
