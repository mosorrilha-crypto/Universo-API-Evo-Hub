import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import { isStandalonePwa } from '../lib/pwa';
import { hasRoleAtLeast } from '../lib/roles';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import {
  Archive,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home,
  Kanban,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  ShieldCheck,
  Sun,
  Target,
  User,
  X,
} from 'lucide-react';

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

type NavigationItem = { id: ActiveTab; label: string; icon: React.ReactNode; accent?: 'emerald' | 'sky' | 'amber' };

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
  const { language, setLanguage, theme, setTheme } = useAppPreferences();
  const tabsRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isAdminToolsMenuOpen, setIsAdminToolsMenuOpen] = useState(false);
  const [isInstalledApp] = useState(() => isStandalonePwa());
  const isSpanish = language === 'es';
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'blue' : 'dark');
  const canSeeFinancial = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'manager');
  const canSeeAdminTools = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'admin');
  const canSeeSaasMaster = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'saas_admin');

  const copy = isSpanish ? {
    platform: 'Central de operación por WhatsApp', subtitle: 'Atención, CRM, agenda, caja y conversiones en un solo lugar', today: 'Hoy', chat: 'WhatsApp', sales: 'CRM', schedule: 'Agenda y Caja', growth: 'Crecimiento', quality: 'Calidad de IA', knowledge: 'Conocimiento', integration: 'Integraciones', escalations: 'Pendientes', companies: 'Empresas', adminGroup: 'Administración', signIn: 'Ingresar', signOut: 'Salir', activeCompany: 'Empresa activa', changeOperator: 'Cambiar operador', previous: 'Desplazar menú a la izquierda', next: 'Desplazar menú a la derecha', menu: 'Menú'
  } : {
    platform: 'Central de operação por WhatsApp', subtitle: 'Atendimento, CRM, agenda, caixa e conversões em um só lugar', today: 'Hoje', chat: 'WhatsApp', sales: 'CRM', schedule: 'Agenda & Caixa', growth: 'Crescimento', quality: 'Qualidade IA', knowledge: 'Conhecimento', integration: 'Integrações', escalations: 'Pendências', companies: 'Empresas', adminGroup: 'Administração', signIn: 'Entrar', signOut: 'Sair', activeCompany: 'Empresa ativa', changeOperator: 'Trocar operador', previous: 'Rolar menu para a esquerda', next: 'Rolar menu para a direita', menu: 'Menu'
  };

  const primaryNavigation: NavigationItem[] = [
    { id: 'home', label: copy.today, icon: <Home className="w-4 h-4" /> },
    { id: 'whatsapp', label: copy.chat, icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'crm', label: copy.sales, icon: <Kanban className="w-4 h-4" /> },
    ...(canSeeFinancial ? [{ id: 'agenda_financeiro' as ActiveTab, label: copy.schedule, icon: <CalendarDays className="w-4 h-4" /> }] : []),
  ];
  const adminNavigation: NavigationItem[] = canSeeAdminTools ? [
    { id: 'escalations', label: copy.escalations, icon: <Archive className="w-4 h-4" />, accent: 'amber' },
  ] : [];
  const adminToolsNavigation: NavigationItem[] = canSeeAdminTools ? [
    ...(canSeeSaasMaster ? [{ id: 'saas' as ActiveTab, label: copy.companies, icon: <Layers className="w-4 h-4" /> }] : []),
    { id: 'attribution', label: copy.growth, icon: <Target className="w-4 h-4" /> },
    { id: 'quality', label: copy.quality, icon: <ShieldCheck className="w-4 h-4" />, accent: 'sky' },
    { id: 'knowledge', label: copy.knowledge, icon: <Brain className="w-4 h-4" /> },
    { id: 'integration', label: copy.integration, icon: <Layers className="w-4 h-4" /> },
  ] : [];
  const isAdminToolsActive = adminToolsNavigation.some((item) => item.id === activeTab);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const close = (event: MouseEvent) => { if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setIsProfileMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isAdminToolsMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-admin-tools-menu]')) setIsAdminToolsMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isAdminToolsMenuOpen]);

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
    setIsAdminToolsMenuOpen(false);
  };
  const scrollTabs = (direction: 'left' | 'right') => tabsRef.current?.scrollBy({ left: direction === 'left' ? -320 : 320, behavior: 'smooth' });
  const tabClass = (item: NavigationItem) => {
    if (activeTab !== item.id) return 'text-slate-300 hover:text-white hover:bg-slate-800/80';
    if (item.accent === 'sky') return 'bg-sky-600 text-white shadow-sm shadow-sky-950/40';
    if (item.accent === 'amber') return 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-950/40';
    return 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40';
  };
  const renderTab = (item: NavigationItem) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${tabClass(item)}`}><span className={activeTab === item.id ? 'text-current' : item.accent === 'sky' ? 'text-sky-300' : item.accent === 'amber' ? 'text-amber-300' : 'text-emerald-400'}>{item.icon}</span><span>{item.label}</span>{item.id === 'whatsapp' && savedCount > 0 && <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] font-bold">{savedCount}</span>}</button>;
  const renderAdminTool = (item: NavigationItem) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} role="menuitem" className={`inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${activeTab === item.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><span className={activeTab === item.id ? 'text-emerald-300' : item.accent === 'sky' ? 'text-sky-300' : 'text-slate-400'}>{item.icon}</span><span className="truncate">{item.label}</span>{activeTab === item.id && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}</button>;

  const renderAdminToolsMenu = (placement: 'mobile' | 'desktop') => canSeeAdminTools ? (
    <div className={placement === 'desktop' ? 'relative shrink-0' : 'w-full'} data-admin-tools-menu>
      <button
        type="button"
        onClick={() => setIsAdminToolsMenuOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={isAdminToolsMenuOpen}
        className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${isAdminToolsActive ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'} ${placement === 'mobile' ? 'w-full justify-between' : ''}`}
      >
        <span className="inline-flex items-center gap-2"><Layers className="h-4 w-4 text-emerald-300" /><span>{canSeeSaasMaster ? copy.companies : copy.adminGroup}</span></span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isAdminToolsMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {isAdminToolsMenuOpen && <div className={`${placement === 'desktop' ? 'absolute left-0 top-full z-40 mt-2 w-64' : 'mt-2 w-full'} rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl`} role="menu" aria-label={canSeeSaasMaster ? copy.companies : copy.adminGroup}>{adminToolsNavigation.map(renderAdminTool)}</div>}
    </div>
  ) : null;

  return <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900 shadow-md">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><MessageSquare className="w-4 h-4" /></div><span className="truncate text-sm font-bold text-white">Universo</span></div>
        <div className="flex items-center gap-1"><button type="button" onClick={() => setLanguage(language === 'pt' ? 'es' : 'pt')} className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-200" title={isSpanish ? 'Português' : 'Español'}>{isSpanish ? 'PT' : 'ES'}</button><button type="button" onClick={toggleTheme} className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800" title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>{theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button><button type="button" onClick={() => { setIsMobileMenuOpen((value) => !value); setIsAdminToolsMenuOpen(false); }} className="rounded-md p-1.5 text-slate-200 hover:bg-slate-800" title={copy.menu}>{isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}</button></div>
      </div>
      {isMobileMenuOpen && <div className="border-t border-slate-800 pb-3 pt-2 md:hidden">
        <div className="flex flex-col gap-1 pb-1">{primaryNavigation.map(renderTab)}{adminNavigation.map(renderTab)}{renderAdminToolsMenu('mobile')}</div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
          <div className="min-w-0"><p className="text-[10px] text-slate-500">{copy.activeCompany}</p><p className="truncate text-xs font-semibold text-slate-200">{activeTenant.name}</p></div>
          {currentUser ? <button type="button" onClick={onLogout} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-300"><LogOut className="w-3.5 h-3.5" />{copy.signOut}</button> : <button type="button" onClick={onOpenLoginModal} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300"><User className="w-3.5 h-3.5" />{copy.signIn}</button>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" role="group" aria-label="Modo visual">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Modo visual</span>
          <div className="flex items-center gap-1">
            {([
              { id: 'dark' as const, label: 'Escuro', icon: Moon },
              { id: 'light' as const, label: 'Claro', icon: Sun },
              { id: 'blue' as const, label: 'Azul', icon: Layers },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${theme === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
              >
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>}
      <div className="hidden items-center justify-between gap-5 py-4 md:flex">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-inner"><MessageSquare className="w-5 h-5" /></div><div className="min-w-0"><h1 className="truncate text-xl font-bold tracking-tight text-white">{copy.platform}</h1><p className="truncate text-xs text-slate-400">{copy.subtitle}</p></div></div>
        <div className="flex shrink-0 items-center gap-2"><div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label="Idioma"><button type="button" onClick={() => setLanguage('pt')} className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${language === 'pt' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>PT</button><button type="button" onClick={() => setLanguage('es')} className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${language === 'es' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>ES</button></div><button type="button" onClick={toggleTheme} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white" title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>{theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>{currentUser ? <div className="relative" ref={profileMenuRef}><button type="button" onClick={() => currentUser.role === 'saas_admin' ? setIsProfileMenuOpen((value) => !value) : onOpenLoginModal()} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 p-1.5 pl-2.5 text-left text-slate-200 transition-colors hover:bg-slate-800"><img src={currentUser.avatar} alt={currentUser.name} className="h-7 w-7 rounded-full border border-emerald-500/50 object-cover" /><span className="hidden max-w-28 truncate text-xs font-bold text-white lg:block">{currentUser.name}</span><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`} /></button>{currentUser.role === 'saas_admin' && isProfileMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{copy.activeCompany}</p><div className="max-h-56 space-y-1 overflow-y-auto">{tenants.map((tenant) => <button key={tenant.id} type="button" onClick={() => { onSelectTenant(tenant); setIsProfileMenuOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${tenant.id === activeTenant.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800'}`}><span className="truncate">{tenant.name}</span>{tenant.id === activeTenant.id && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}</button>)}</div><button type="button" onClick={() => { setIsProfileMenuOpen(false); onOpenLoginModal(); }} className="mt-2 w-full border-t border-slate-800 px-2.5 pt-2 text-left text-xs font-medium text-slate-300 hover:text-white">{copy.changeOperator}</button></div>}</div> : <button type="button" onClick={onOpenLoginModal} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400"><User className="w-4 h-4" />{copy.signIn}</button>}{currentUser && <button type="button" onClick={onLogout} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300" title={copy.signOut}><LogOut className="w-4 h-4" /></button>}</div>
      </div>
      <div className="hidden items-center gap-0.5 rounded-control border border-slate-700 bg-slate-950/50 p-0.5 md:flex" role="group" aria-label="Modo visual">
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
      <div className="hidden items-center border-t border-slate-800/80 py-1.5 md:flex"><button type="button" onClick={() => scrollTabs('left')} className="mr-1 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-300" title={copy.previous}><ChevronLeft className="w-4 h-4" /></button><div ref={tabsRef} className="flex w-full items-center gap-1 overflow-x-auto scroll-smooth py-0.5">{primaryNavigation.map(renderTab)}{adminNavigation.map(renderTab)}{renderAdminToolsMenu('desktop')}</div><button type="button" onClick={() => scrollTabs('right')} className="ml-1 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-300" title={copy.next}><ChevronRight className="w-4 h-4" /></button></div>
    </div>
  </header>;
};
