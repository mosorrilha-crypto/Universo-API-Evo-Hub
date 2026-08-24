import type { ActiveTab } from '../types';

export const ACTIVE_TAB_STORAGE_KEY = 'saas_active_tab';

const ACTIVE_TAB_VALUES: readonly ActiveTab[] = [
  'home',
  'whatsapp',
  'crm',
  'financial',
  'agenda_financeiro',
  'saas',
  'attribution',
  'knowledge',
  'catalog',
  'escalations',
  'quality',
];

export function parseStoredActiveTab(value: string | null): ActiveTab {
  // Integrações deixou de ser uma tela de operação. Migra a preferência antiga
  // para Atendimento para que um refresh não reabra uma página descontinuada.
  if (value === 'integration') return 'whatsapp';
  return value && ACTIVE_TAB_VALUES.includes(value as ActiveTab) ? value as ActiveTab : 'home';
}
