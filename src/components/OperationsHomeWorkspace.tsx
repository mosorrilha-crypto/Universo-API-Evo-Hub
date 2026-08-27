/** Início móvel — prioriza pendências e deixa atalhos/configuração sob escolha explícita. */
import { useState } from 'react';
import { CheckSquare, Settings2, Zap } from 'lucide-react';
import { OperationsCenter } from './OperationsCenter';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import type { AgentKnowledgeBase, BusinessHours, EscalationInfo, FinancialTransaction, LeadInfo, Tenant, UserProfile } from '../types';

type HomeMobileSection = 'priorities' | 'shortcuts' | 'setup';

interface OperationsHomeWorkspaceProps {
  activeTenant: Tenant;
  currentUser: UserProfile | null;
  leads: LeadInfo[];
  transactions: FinancialTransaction[];
  escalations: EscalationInfo[];
  knowledgeBase: AgentKnowledgeBase;
  businessHours: BusinessHours;
  canSeeAgenda: boolean;
  canSeeFinancial: boolean;
  canSeeAdminTools: boolean;
  onNavigate: (tab: import('../types').ActiveTab) => void;
}

export function OperationsHomeWorkspace(props: OperationsHomeWorkspaceProps) {
  const [mobileSection, setMobileSection] = useState<HomeMobileSection>('priorities');
  const { language } = useAppPreferences();
  const items: Array<{ id: HomeMobileSection; label: string; icon: typeof CheckSquare }> = language === 'es'
    ? [{ id: 'priorities', label: 'Prioridades', icon: CheckSquare }, { id: 'shortcuts', label: 'Accesos', icon: Zap }, { id: 'setup', label: 'Configurar', icon: Settings2 }]
    : [{ id: 'priorities', label: 'Prioridades', icon: CheckSquare }, { id: 'shortcuts', label: 'Atalhos', icon: Zap }, { id: 'setup', label: 'Configurar', icon: Settings2 }];

  return (
    <div className="operations-home-mobile-workspace space-y-3">
      <nav className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-950/95 p-1.5 sm:hidden" aria-label={language === 'es' ? 'Inicio operativo' : 'Início operacional'}>{items.map((item) => { const Icon = item.icon; const active = mobileSection === item.id; return <button key={item.id} type="button" onClick={() => setMobileSection(item.id)} aria-pressed={active} className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold transition ${active ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon className="h-3.5 w-3.5" />{item.label}</button>; })}</nav>
      <OperationsCenter {...props} mobileSection={mobileSection} />
    </div>
  );
}
