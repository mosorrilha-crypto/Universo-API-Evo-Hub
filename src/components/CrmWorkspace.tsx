/** CRM móvel — lista de leads na entrada, indicadores e quadro por seleção explícita. */
import { useState } from 'react';
import { BarChart3, Kanban, UsersRound } from 'lucide-react';
import { OperatorCRM } from './OperatorCRM';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import type { LeadInfo, UserProfile } from '../types';

type CrmMobileSection = 'leads' | 'insights' | 'board';

interface CrmWorkspaceProps {
  leads?: LeadInfo[];
  onUpdateLead?: (updatedLead: LeadInfo) => void;
  onDeleteLead?: (leadId: string) => void;
  onClearAllLeads?: () => void;
  currentUser?: UserProfile | null;
  onNavigateToFinancial?: (lead: LeadInfo) => void;
}

export function CrmWorkspace(props: CrmWorkspaceProps) {
  const [mobileSection, setMobileSection] = useState<CrmMobileSection>('leads');
  const { language } = useAppPreferences();
  const labels = language === 'es'
    ? { leads: 'Leads', insights: 'Indicadores', board: 'Tablero' }
    : { leads: 'Leads', insights: 'Indicadores', board: 'Quadro' };
  const items: Array<{ id: CrmMobileSection; label: string; icon: typeof UsersRound }> = [
    { id: 'leads', label: labels.leads, icon: UsersRound },
    { id: 'insights', label: labels.insights, icon: BarChart3 },
    { id: 'board', label: labels.board, icon: Kanban },
  ];

  return (
    <div className="crm-mobile-workspace space-y-3">
      <nav className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-950/95 p-1.5 sm:hidden" aria-label={language === 'es' ? 'Visiones de ventas' : 'Visões de vendas'}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = mobileSection === item.id;
          return <button key={item.id} type="button" onClick={() => setMobileSection(item.id)} aria-pressed={active} className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold transition ${active ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon className="h-3.5 w-3.5" />{item.label}</button>;
        })}
      </nav>
      <OperatorCRM {...props} mobileSection={mobileSection} />
    </div>
  );
}
