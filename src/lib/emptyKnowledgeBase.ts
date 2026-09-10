import { AgentKnowledgeBase } from '../types';

// TASK-0376: extraído de `components/AgentKnowledgeBase.tsx` (3800+ linhas)
// pra um módulo próprio e pequeno. `App.tsx` usa este valor como estado
// inicial/fallback em todo carregamento (não só na aba Base de Conhecimento),
// então precisa importá-lo sem puxar o componente inteiro — o objetivo desta
// tarefa é justamente lazy-loadear esse componente, que só é necessário
// quando a aba é aberta. `AgentKnowledgeBase.tsx` reexporta este valor pra
// não quebrar quem já importava daquele caminho.
export const emptyKnowledgeBase: AgentKnowledgeBase = {
  companyName: '',
  agentGoal: '',
  toneOfVoice: '',
  businessModel: '',
  pricingAndPolicies: '',
  products: [],
  businessRules: [],
  faqs: [],
  documents: [],
};
