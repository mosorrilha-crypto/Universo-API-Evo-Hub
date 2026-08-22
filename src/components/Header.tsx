import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Home,
  Kanban,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Sun,
  Moon,
  UserRound,
  X,
} from 'lucide-react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import { isStandalonePwa } from '../lib/pwa';
import { hasRoleAtLeast } from '../lib/roles';
import { useAppPreferences } from '../contexts/AppPreferencesContext';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  savedCount: number;
  currentUser: UserProfile | null;
  onOpenLoginModal: () => void;
  onLogout: () => void;
  tenants: Tenant[];
  activeTenant: Tenant;
  onSelectTenant: (tenant: Tenant) => void;
}

type NavigationItem = {
  id: ActiveTab;
  label: string;
  description: string;
  icon: React.ElementType;
  visible: boolean;
};

const firstName = (name?: string | null) => (name || 'Operador').trim().split(/\s+/)[0] || 'Operador';

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  savedCount,
  currentUser,
  onOpenLoginModal,
  onLogout,
  tenants,
  activeTenant,
  onSelectTenant,
}) => {
  const { language, setLanguage, theme, setTheme, t } = useAppPreferences();
  const [isInstalledApp] = useState(() => isStandalonePwa());
  const canSeeFinancial = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'manager');
  const canSeeAdminTools = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'admin');
  const canSeeSaasMaster = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'saas_admin');
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProfileOpen) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setIsProfileOpen(false);
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [isProfileOpen]);

  const tabLabels: Partial<Record<ActiveTab, string>> = {
    home: t('home'),
    whatsapp: t('conversations'),
    crm: t('sales'),
    agenda_financeiro: t('scheduleCash'),
    attribution: t('growth'),
    knowledge: t('configure'),
    quality: t('aiQuality'),
    escalations: t('pending'),
    saas: t('companies'),
  };

  const primaryNavigation: NavigationItem[] = [
    { id: 'home', label: t('home'), description: t('homeDescription'), icon: Home, visible: true },
    { id: 'whatsapp', label: t('conversations'), description: t('conversationsDescription'), icon: MessageSquare, visible: true },
    { id: 'crm', label: t('sales'), description: t('salesDescription'), icon: Kanban, visible: true },
    { id: 'agenda_financeiro', label: t('scheduleCash'), description: t('scheduleCashDescription'), icon: CalendarDays, visible: canSeeFinancial },
  ];

  const growthNavigation: NavigationItem[] = [
    { id: 'attribution', label: t('growth'), description: t('growthDescription'), icon: BarChart3, visible: canSeeAdminTools },
  ];

  const settingsNavigation: NavigationItem[] = [
    { id: 'knowledge', label: t('configure'), description: t('configureDescription'), icon: Settings2, visible: canSeeAdminTools },
    { id: 'quality', label: t('aiQuality'), description: t('aiQualityDescription'), icon: ShieldCheck, visible: canSeeAdminTools },
  ];

  const navigate = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMobileOpen(false);
  };

  const navigationBlock = (items: NavigationItem[], label?: string) => {
    const visibleItems = items.filter((item) => item.visible);
    if (!visibleItems.length) return null;
    return (
      <div className="space-y-1">
        {label && <p className="px-2.5 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>}
        {visibleItems.map((item) => (
          <NavigationButton key={item.id} item={item} active={activeTab === item.id} onClick={() => navigate(item.id)} />
        ))}
      </div>
    );
  };

  const preferencesBar = (
    <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 rounded-panel border border-slate-800 bg-slate-900/65 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{t('language')}</span>
        <div className="flex overflow-hidden rounded-control border border-slate-700 bg-slate-950/50 p-0.5">
          {(['pt', 'es'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setLanguage(item)}
              aria-pressed={language === item}
              title={item === 'pt' ? 'Português' : 'Español'}
              className={`rounded px-1.5 py-0.5 text-[9px] font-black transition-colors ${language === item ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-0.5 rounded-control border border-slate-700 bg-slate-950/50 p-0.5" role="group" aria-label="Modo visual">
        {([
          { id: 'dark' as const, label: 'Escuro', icon: Moon },
          { id: 'light' as const, label: 'Claro', icon: Sun },
          { id: 'blue' as const, label: 'Azul', icon: Layers },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTheme(id)}
            title={`Modo ${label}`}
            aria-label={`Modo ${label}`}
            aria-pressed={theme === id}
            className={`rounded px-1.5 py-1 transition-colors ${theme === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );

  const profilePanel = (
    <div className="relative mt-auto pt-3" ref={profileMenuRef}>
      {canSeeSaasMaster && isProfileOpen && (
        <div className="absolute bottom-[calc(100%+0.65rem)] left-0 right-0 z-50 overflow-hidden rounded-card border border-slate-700 bg-slate-900 p-2 shadow-2xl shadow-slate-950/60 animate-pop-in">
          <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{t('switchCompany')}</p>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => { onSelectTenant(tenant); setIsProfileOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-xs transition-colors ${tenant.id === activeTenant.id ? 'bg-emerald-500/12 text-emerald-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="min-w-0 flex-1 truncate font-semibold">{tenant.name}</span>
                {tenant.id === activeTenant.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
          <button onClick={() => { setIsProfileOpen(false); onOpenLoginModal(); }} className="mt-2 flex w-full items-center gap-2 border-t border-slate-800 px-2.5 pt-2.5 text-left text-xs font-semibold text-slate-400 transition-colors hover:text-white">
            <UserRound className="h-3.5 w-3.5" /> {t('switchOperator')}
          </button>
        </div>
      )}

      {currentUser ? (
        <div className="rounded-card border border-slate-800 bg-slate-900/90 p-2 shadow-lg shadow-slate-950/25">
          <button
            onClick={() => canSeeSaasMaster ? setIsProfileOpen((open) => !open) : onOpenLoginModal()}
            className="flex w-full items-center gap-2.5 rounded-panel p-1 text-left transition-colors hover:bg-slate-800"
            title={canSeeSaasMaster ? `${t('switchCompany')} / ${t('switchOperator')}` : t('switchOperator')}
          >
            <img src={currentUser.avatar} alt={currentUser.name} className="h-8 w-8 shrink-0 rounded-pill border border-emerald-400/35 object-cover" />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{firstName(currentUser.name)}</span><span className="mt-0.5 block truncate text-[10px] capitalize text-emerald-400">{currentUser.role.replace('_', ' ')}</span></span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
          </button>
          <button onClick={onLogout} className="mt-1.5 flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300">
            <LogOut className="h-3.5 w-3.5" /> {t('logout')}
          </button>
        </div>
      ) : (
        <button onClick={onOpenLoginModal} className="flex w-full items-center justify-center gap-2 rounded-panel bg-emerald-500 px-3 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/30 transition-transform active:scale-[0.98]">
          <UserRound className="h-4 w-4" /> {t('login')}
        </button>
      )}
    </div>
  );

  const sidePanel = (mobile = false) => (
    <div className={`flex h-full flex-col ${mobile ? 'p-4' : 'p-2.5'}`}>
      <div className="flex items-center gap-2.5 px-1.5 py-1.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-panel border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 shadow-inner shadow-emerald-950/30"><MessageSquare className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold tracking-tight text-white">Universo</span><span className="block truncate text-[9px] font-medium text-slate-500">{t('appSubtitle')}</span></span>
        {mobile && <button onClick={() => setIsMobileOpen(false)} className="rounded-control p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>}
      </div>

      <div className="mt-3 rounded-panel border border-slate-800 bg-slate-900/70 px-2.5 py-2">
        <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-control bg-emerald-500/10 text-emerald-400"><Building2 className="h-3 w-3" /></span><span className="truncate text-[11px] font-bold text-slate-200">{activeTenant.name}</span></div>
      </div>

      {preferencesBar}

      <nav className="mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {navigationBlock(primaryNavigation)}
        {navigationBlock(growthNavigation, t('performance'))}
        {navigationBlock(settingsNavigation, t('administration'))}
        {canSeeSaasMaster && (
          <div className="space-y-1">
            <p className="px-2.5 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{t('platform')}</p>
            <NavigationButton item={{ id: 'saas', label: t('companies'), description: t('companiesDescription'), icon: Layers, visible: true }} active={activeTab === 'saas'} onClick={() => navigate('saas')} />
          </div>
        )}
      </nav>

      <div className="mt-2 rounded-panel border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[9px] text-slate-500">
        <span className="font-semibold text-slate-400">{savedCount}</span> {t('serviceHistory')}
      </div>
      {profilePanel}
    </div>
  );

  return (
    <>
      <aside className="hidden h-screen w-[228px] shrink-0 border-r border-slate-800/80 bg-slate-950/90 lg:sticky lg:top-0 lg:flex">
        {sidePanel()}
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <button onClick={() => setIsMobileOpen(true)} className="rounded-control border border-slate-800 bg-slate-900 p-2 text-slate-300"><Menu className="h-4 w-4" /></button>
        <div className="min-w-0 text-center"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">Universo</p><p className="truncate text-sm font-bold text-white">{tabLabels[activeTab] || 'Operação'}</p></div>
        <button onClick={() => navigate('home')} className="rounded-control border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-300"><Home className="h-4 w-4" /></button>
      </header>

      {isMobileOpen && (
        <div className="fixed inset-0 z-[60] flex lg:hidden">
          <button aria-label="Fechar menu" onClick={() => setIsMobileOpen(false)} className="flex-1 bg-slate-950/75 backdrop-blur-sm" />
          <aside className="h-full w-[min(86vw,330px)] border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/60">{sidePanel(true)}</aside>
        </div>
      )}
    </>
  );
};

const NavigationButton: React.FC<{ item: NavigationItem; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={`group flex w-full items-center gap-2.5 rounded-panel px-2.5 py-2 text-left transition-all ${active ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-950/30' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}>
      <span className={`flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-control ${active ? 'bg-slate-950/12' : 'bg-slate-800/65 text-emerald-400 group-hover:bg-slate-800'}`}><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">{item.label}</span><span className={`mt-0.5 block truncate text-[9px] ${active ? 'text-slate-900/70' : 'text-slate-500'}`}>{item.description}</span></span>
      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${active ? 'text-slate-900/65' : 'text-slate-700 group-hover:translate-x-0.5 group-hover:text-slate-400'}`} />
    </button>
  );
};
