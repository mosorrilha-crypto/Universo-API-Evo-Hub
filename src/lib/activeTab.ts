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
  'integration',
  'escalations',
  'quality',
];

export function parseStoredActiveTab(value: string | null): ActiveTab {
  return value && ACTIVE_TAB_VALUES.includes(value as ActiveTab) ? value as ActiveTab : 'home';
}
