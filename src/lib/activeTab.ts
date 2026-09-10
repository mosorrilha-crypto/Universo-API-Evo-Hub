import type { ActiveTab } from '../types';

export const ACTIVE_TAB_STORAGE_KEY = 'saas_active_tab';

const ACTIVE_TAB_VALUES: readonly ActiveTab[] = [
  'whatsapp',
  'crm',
  'agenda',
  'financial',
  'saas',
  'attribution',
  'knowledge',
  'catalog',
  'escalations',
  'quality',
  'system_logs',
  'broadcast',
];

export function parseStoredActiveTab(value: string | null): ActiveTab {
  // Migra preferências de rotas descontinuadas para o destino operacional equivalente.
  // TASK-0301: "home" (painel "Hoje") saiu — o Atendimento passou a ser a
  // tela padrão do sistema.
  if (value === 'integration' || value === 'home') return 'whatsapp';
  if (value === 'agenda_financeiro') return 'agenda';
  return value && ACTIVE_TAB_VALUES.includes(value as ActiveTab) ? value as ActiveTab : 'whatsapp';
}
