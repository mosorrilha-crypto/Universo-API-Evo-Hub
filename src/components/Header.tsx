/**
 * Direção visual: Operação Serena — manter a navegação empresarial discreta,
 * previsível e acessível, sem alterar a identidade visual existente.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import { hasRoleAtLeast } from '../lib/roles';
import type { TenantNavigationCapabilities } from '../lib/tenantCapabilities';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Layers,
  Link2,
  Radio,
  ScrollText,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  ShieldCheck,
  Settings2,
  Sparkles,
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
  capabilities: TenantNavigationCapabilities;
  /** Confirmação vinda do servidor; impede que perfil antigo do navegador libere Empresas. */
  canAccessSaasAdmin?: boolean;
  /** TASK-0225: contagem de escalonamentos pendentes, pro ícone de
      Pendências ao lado do seletor de idioma (desktop) — mesma expressão
      já calculada em App.tsx pra WhatsAppLeadsSim. */
  escalationsPendingCount?: number;
  /** TASK-0261: abre o modal de troca de senha — disponível pra qualquer
      operador logado, ao contrário do menu de perfil (só saas_admin). */
  onOpenChangePasswordModal: () => void;
  /** TASK-0284: exibe o erro do toggle de notificações push (ver
      usePushNotifications) — mesmo `showToast` já usado em outras telas de
      App.tsx, só que opcional aqui pra não obrigar quem testa o Header
      isolado (testes) a sempre passar um. */
  onToast?: (message: string) => void;
}

type NavigationItem = { id: ActiveTab; label: string; icon: React.ReactNode; accent?: 'emerald' | 'sky' | 'amber' };
type ToolsMenuKind = 'configuration' | 'theme';
type DesktopMenuPosition = { top: number; left: number };

const firstName = (name?: string | null) => (name || 'Operador').trim().split(/\s+/)[0] || 'Operador';

// TASK-0289 (pedido direto, print real): o botão de tema no topo do menu
// ciclava entre os 4 temas mas o ícone/tooltip só tinha 2 estados (Sun/Moon)
// — pra light/blue/clean (3 dos 4) mostrava o mesmo ícone de lua e a mesma
// dica "Modo escuro", sem indicar o tema atual nem o que o clique faria.
// Vira um popover com os 4 nomeados (mesmo array que já existia na fileira
// "Modo visual", agora removida daqui — o ícone do topo passa a bastar).
const THEME_OPTIONS = [
  { id: 'dark' as const, label: 'Escuro', icon: Moon },
  { id: 'light' as const, label: 'Claro', icon: Sun },
  { id: 'blue' as const, label: 'Azul', icon: Layers },
  { id: 'clean' as const, label: 'Limpo', icon: Sparkles },
];

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
  capabilities,
  canAccessSaasAdmin,
  escalationsPendingCount = 0,
  onOpenChangePasswordModal,
  onToast,
}) => {
  const { language, setLanguage, theme, setTheme } = useAppPreferences();
  // TASK-0284 (pedido direto, com print do menu ⋮ real do WhatsApp, sem
  // item de configuração de conta misturado com ações da conversa): o
  // toggle de notificações push do PWA do atendente vinha do menu ⋮ da
  // conversa aberta (WhatsAppLeadsSim.tsx) — não é uma ação de uma
  // conversa específica, é configuração de conta/dispositivo. Mora aqui
  // agora, visível em qualquer aba (não só dentro do Atendimento).
  const { pushEnabled, pushBusy, pushError, togglePush } = usePushNotifications();
  useEffect(() => {
    if (pushError) onToast?.(pushError);
  }, [pushError]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const mobileTenantMenuRef = useRef<HTMLDivElement>(null);
  const configurationButtonRef = useRef<HTMLButtonElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuTouchStartY = useRef<number | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [openToolsMenu, setOpenToolsMenu] = useState<ToolsMenuKind | null>(null);
  const [isMobileTenantMenuOpen, setIsMobileTenantMenuOpen] = useState(false);
  const [desktopMenuPosition, setDesktopMenuPosition] = useState<DesktopMenuPosition | null>(null);
  const isSpanish = language === 'es';
  const activeThemeOption = THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
  // A navegação só aparece quando o papel tem permissão E a capacidade está
  // habilitada para a empresa ativa. O segundo critério impede que o Admin
  // SaaS veja, no tenant selecionado, recursos bloqueados no card de
  // controle — revertido em 30/08/2026 (pedido direto do dono do produto)
  // depois que um commit anterior ("fix: preserva acesso do saas admin aos
  // recursos", 27/08/2026) fez o SaaS Admin ignorar `capabilities` e ver
  // tudo sempre "para auditoria": na prática isso quebrou a função de
  // pré-visualizar uma empresa exatamente como ela é (ex: Clic Piscinas,
  // que só tem 6 recursos liberados, aparecia com todos). A única coisa
  // exclusiva do SaaS Admin continua sendo o próprio seletor de empresas
  // (`canSeeSaasMaster`, usado abaixo em `saasNavigation`/tenant menu) pra
  // voltar à conta principal — Logs do Sistema é a exceção intencional que
  // sempre foi assim (o SaaS Admin sempre audita, ver comentário abaixo).
  const canSeeSaasMaster = canAccessSaasAdmin ?? hasRoleAtLeast(currentUser?.role, 'saas_admin');
  const canSeeConversations = hasRoleAtLeast(currentUser?.role, 'operator') && capabilities.conversations;
  const canSeeFinancial = hasRoleAtLeast(currentUser?.role, 'manager') && capabilities.financial;
  const canSeeSystemLogs = canSeeSaasMaster || (hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.systemLogs);
  const canSeeBroadcast = canSeeSaasMaster || (hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.broadcast);
  const canSeeGrowth = hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.growth;
  const canSeeAgentTools = hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.agent;
  const canSeeCatalog = hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.catalog;
  const canSeeQuality = hasRoleAtLeast(currentUser?.role, 'admin') && capabilities.quality;

  const copy = isSpanish ? {
    platform: 'Central de operación por WhatsApp', subtitle: canSeeFinancial ? 'Atención, ventas, agenda, finanzas y conversiones en un solo lugar' : 'Atención, ventas, agenda y conversiones en un solo lugar', today: 'Hoy', conversations: 'Conversaciones', sales: 'Ventas', schedule: 'Agenda', financial: 'Finanzas', growth: 'Crecimiento', quality: 'Calidad del agente', systemLogs: 'Logs del sistema', broadcast: 'Envío Masivo', agentCatalog: 'Agente y catálogo', publicCatalog: 'Catálogo público', configure: 'Configurar', companies: 'Empresas', signIn: 'Ingresar', signOut: 'Salir', activeCompany: 'Empresa activa', changeOperator: 'Cambiar operador', previous: 'Desplazar menú a la izquierda', next: 'Desplazar menú a la derecha', menu: 'Menú'
  } : {
    platform: 'Central de operação por WhatsApp', subtitle: canSeeFinancial ? 'Atendimento, vendas, agenda, financeiro e conversões em um só lugar' : 'Atendimento, vendas, agenda e conversões em um só lugar', today: 'Hoje', conversations: 'Conversas', sales: 'Vendas', schedule: 'Agenda', financial: 'Financeiro', growth: 'Crescimento', quality: 'Qualidade do agente', systemLogs: 'Logs do sistema', broadcast: 'Disparo em Massa', agentCatalog: 'Agente & catálogo', publicCatalog: 'Catálogo público', configure: 'Configurar', companies: 'Empresas', signIn: 'Entrar', signOut: 'Sair', activeCompany: 'Empresa ativa', changeOperator: 'Trocar operador', previous: 'Rolar menu para a esquerda', next: 'Rolar menu para a direita', menu: 'Menu'
  };

  // TASK-0301 (pedido direto): Atendimento vira a tela padrão do sistema —
  // saiu do menu superior (não precisa mais de botão próprio, é onde o
  // operador já cai ao abrir o app; ver logo clicável mais abaixo pra
  // voltar). CRM/Agenda/Financeiro também saíram do topo por pedido direto
  // — só ficam acessíveis pela caixa de ferramentas dentro do Atendimento
  // (mobile, ver WhatsAppLeadsSim.tsx `onGoToCrm`/`onGoToAgenda`/
  // `onGoToFinancial`). Menu superior fica só com Crescimento, Configurar
  // e Empresas.
  const primaryNavigation: NavigationItem[] = [
    ...(canSeeGrowth ? [{ id: 'attribution' as ActiveTab, label: copy.growth, icon: <Target className="w-4 h-4" />, accent: 'sky' as const }] : []),
  ];
  const configurationNavigation: NavigationItem[] = [
    ...(canSeeAgentTools ? [{ id: 'knowledge' as ActiveTab, label: copy.agentCatalog, icon: <Brain className="w-4 h-4" /> }] : []),
    ...(canSeeCatalog ? [{ id: 'catalog' as ActiveTab, label: copy.publicCatalog, icon: <Link2 className="w-4 h-4" /> }] : []),
    ...(canSeeQuality ? [{ id: 'quality' as ActiveTab, label: copy.quality, icon: <ShieldCheck className="w-4 h-4" />, accent: 'sky' as const }] : []),
    ...(canSeeSystemLogs ? [{ id: 'system_logs' as ActiveTab, label: copy.systemLogs, icon: <ScrollText className="w-4 h-4" />, accent: 'sky' as const }] : []),
    ...(canSeeBroadcast ? [{ id: 'broadcast' as ActiveTab, label: copy.broadcast, icon: <Radio className="w-4 h-4" />, accent: 'sky' as const }] : []),
  ];
  const saasNavigation: NavigationItem[] = canSeeSaasMaster ? [
    { id: 'saas', label: copy.companies, icon: <Layers className="w-4 h-4" /> },
  ] : [];
  const isConfigurationActive = configurationNavigation.some((item) => item.id === activeTab);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const close = (event: MouseEvent) => { if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setIsProfileMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!openToolsMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-tools-menu]')) setOpenToolsMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenToolsMenu(null);
        configurationButtonRef.current?.focus();
      }
    };
    const closeOnViewportChange = () => setOpenToolsMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [openToolsMenu]);

  useEffect(() => {
    if (!isMobileTenantMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (mobileTenantMenuRef.current && !mobileTenantMenuRef.current.contains(event.target as Node)) setIsMobileTenantMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileTenantMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMobileTenantMenuOpen]);

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
    setOpenToolsMenu(null);
    setIsMobileTenantMenuOpen(false);
  };
  const scrollTabs = (direction: 'left' | 'right') => tabsRef.current?.scrollBy({ left: direction === 'left' ? -320 : 320, behavior: 'smooth' });
  // TASK-0195 (pedido direto, 01/09/2026, print do menu mobile): antes deste
  // menu não tinha NENHUM jeito de fechar além de tocar de novo no ícone que
  // abriu ele — nem clique fora, nem gesto — achado real confirmado lendo o
  // código (os outros menus deste arquivo, como o de empresas, sempre
  // tiveram esse listener; este nunca teve). "Empurrar pra cima" = arrastar
  // o dedo de baixo pra cima dentro do menu fecha, igual um bottom
  // sheet/gaveta comum de app mobile.
  const MOBILE_MENU_SWIPE_CLOSE_THRESHOLD = 48;
  const handleMobileMenuTouchStart = (event: React.TouchEvent) => {
    mobileMenuTouchStartY.current = event.touches[0]?.clientY ?? null;
  };
  const handleMobileMenuTouchEnd = (event: React.TouchEvent) => {
    const startY = mobileMenuTouchStartY.current;
    mobileMenuTouchStartY.current = null;
    if (startY === null) return;
    const endY = event.changedTouches[0]?.clientY ?? startY;
    if (startY - endY > MOBILE_MENU_SWIPE_CLOSE_THRESHOLD) setIsMobileMenuOpen(false);
  };
  const toggleToolsMenu = (kind: ToolsMenuKind, placement: 'mobile' | 'desktop') => {
    if (placement === 'desktop' && openToolsMenu !== kind) {
      const triggerRef = kind === 'theme' ? themeButtonRef : configurationButtonRef;
      const triggerBounds = triggerRef.current?.getBoundingClientRect();
      if (triggerBounds) {
        setDesktopMenuPosition({
          top: triggerBounds.bottom + 8,
          left: Math.max(12, Math.min(triggerBounds.left, window.innerWidth - 272)),
        });
      }
    }
    setOpenToolsMenu((value) => value === kind ? null : kind);
  };
  const tabClass = (item: NavigationItem) => {
    if (activeTab !== item.id) return 'text-slate-300 hover:text-white hover:bg-slate-800/80';
    if (item.accent === 'sky') return 'bg-sky-600 text-white shadow-sm shadow-sky-950/40';
    if (item.accent === 'amber') return 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-950/40';
    return 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40';
  };
  const renderTab = (item: NavigationItem) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${tabClass(item)}`}><span className={activeTab === item.id ? 'text-current' : item.accent === 'sky' ? 'text-sky-300' : item.accent === 'amber' ? 'text-amber-300' : 'text-emerald-400'}>{item.icon}</span><span>{item.label}</span>{item.id === 'whatsapp' && savedCount > 0 && <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] font-bold">{savedCount}</span>}</button>;
  const renderSubmenuItem = (item: NavigationItem) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} role="menuitem" className={`inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${activeTab === item.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><span className={activeTab === item.id ? 'text-emerald-300' : item.accent === 'sky' ? 'text-sky-300' : 'text-slate-400'}>{item.icon}</span><span className="truncate">{item.label}</span>{activeTab === item.id && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}</button>;

  const renderToolsMenu = (kind: ToolsMenuKind, placement: 'mobile' | 'desktop', label: string, items: NavigationItem[], isActive: boolean) => {
    if (!items.length) return null;
    const isOpen = openToolsMenu === kind;
    const triggerRef = configurationButtonRef;
    return (
      <div className={placement === 'desktop' ? 'relative shrink-0' : 'w-full'} data-tools-menu>
        <button
          type="button"
          ref={placement === 'desktop' ? triggerRef : undefined}
          onClick={() => toggleToolsMenu(kind, placement)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={`${kind}-menu-${placement}`}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${isActive ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'} ${placement === 'mobile' ? 'w-full justify-between' : ''}`}
        >
          <span className="inline-flex items-center gap-2"><Settings2 className={`h-4 w-4 ${isActive ? 'text-emerald-100' : 'text-emerald-300'}`} /><span>{label}</span></span>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (placement === 'mobile' || desktopMenuPosition) && <div id={`${kind}-menu-${placement}`} className={`${placement === 'desktop' ? 'fixed z-50 w-64' : 'mt-2 w-full'} rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl`} style={placement === 'desktop' ? desktopMenuPosition : undefined} role="menu" aria-label={label}>{items.map(renderSubmenuItem)}</div>}
      </div>
    );
  };

  // TASK-0289 (pedido direto, print real): botão único de tema (ícone
  // sempre reflete o tema ATUAL, um dos 4 — nunca mais Sun/Moon binário
  // escondendo 4 estados) que abre um popover com os 4 nomeados, marca o
  // ativo com checkmark. Reaproveita a mesma infraestrutura de menu
  // suspenso já usada por `renderToolsMenu` (`openToolsMenu`/
  // `toggleToolsMenu`, o `useEffect` de fechar ao clicar fora via
  // `data-tools-menu`, e `desktopMenuPosition` pro posicionamento no
  // desktop) — só o conteúdo/gatilho é diferente (ícone sozinho, sem
  // rótulo nem chevron, mesmo espaço apertado que o botão de tema sempre
  // ocupou aqui).
  const renderThemeMenu = (placement: 'mobile' | 'desktop') => {
    const isOpen = openToolsMenu === 'theme';
    const ActiveIcon = activeThemeOption.icon;
    const triggerClassName = placement === 'mobile'
      ? 'rounded-md p-1.5 text-slate-300 hover:bg-slate-800'
      : 'rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white';
    return (
      <div className="relative" data-tools-menu>
        <button
          type="button"
          ref={placement === 'desktop' ? themeButtonRef : undefined}
          onClick={() => toggleToolsMenu('theme', placement)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={`theme-menu-${placement}`}
          className={triggerClassName}
          title={`${isSpanish ? 'Tema' : 'Tema'}: ${activeThemeOption.label}`}
        >
          <ActiveIcon className={placement === 'mobile' ? 'w-5 h-5' : 'w-4 h-4'} />
        </button>
        {isOpen && (placement === 'mobile' || desktopMenuPosition) && (
          <div
            id={`theme-menu-${placement}`}
            className={`${placement === 'desktop' ? 'fixed z-50' : 'absolute right-0'} mt-2 w-40 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl`}
            style={placement === 'desktop' ? desktopMenuPosition ?? undefined : undefined}
            role="menu"
            aria-label={isSpanish ? 'Tema' : 'Tema'}
          >
            {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setTheme(id); setOpenToolsMenu(null); }}
                role="menuitem"
                className={`inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${theme === id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{label}</span>
                {theme === id && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Bug real reportado (25/08/2026): no iPhone (PWA "adicionado à Tela de
  // Início", viewport-fit=cover já configurado em index.html), este header
  // fixo no topo (sticky top-0) renderizava colado no topo físico da tela,
  // por baixo da barra de status do iOS (relógio/bateria/sinal) — o logo
  // "Universo" e o botão de menu ficavam parcialmente cobertos e o toque no
  // menu não registrava. env(safe-area-inset-top) é 0 em navegador normal
  // (não muda nada fora de PWA em tela cheia/notch), então esse padding só
  // entra em ação exatamente no caso que quebrava.
  // TASK-0226 (achado real, 03/09/2026, pedido direto): este wrapper
  // sempre teve `mx-auto max-w-7xl` fixo, sem saber que a TASK-0222/0225
  // tornaram o conteúdo do Atendimento borda a borda (zera padding/
  // max-width em `.app-main--atendimento`, só quando `activeTab ===
  // 'whatsapp'`) — resultado real reportado: em monitor largo, o
  // cabeçalho e a fileira de abas ficavam presos e centralizados em
  // 1280px enquanto a conversa abaixo já esticava até a borda ("o
  // cabeçalho e o menu não estão estendendo junto"). Sem teto só quando
  // a aba ativa é Atendimento — nas outras abas (Vendas/Agenda/
  // Financeiro/etc.), o conteúdo abaixo continua capado em `max-w-7xl`
  // (não mudou), então o cabeçalho precisa continuar capado igual, senão
  // o mesmo desalinhamento apareceria ao contrário nessas telas.
  //
  // TASK-0231 (03/09/2026): mesma lógica estendida pra "Qualidade da IA"
  // (`app-main--quality`, index.css) — agora também borda a borda.
  const headerInnerClassName = activeTab === 'whatsapp' || activeTab === 'quality' ? 'px-4 sm:px-6 lg:px-8' : 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';
  return <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900 shadow-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
    <div className={headerInnerClassName}>
      <div className="flex items-center justify-between gap-3 py-3 md:hidden">
        {/* Escala aumentada (pedido real, 01/09/2026, com print comparando lado a lado com o WhatsApp Business real): o logo+nome ficava bem menor que o wordmark "WhatsApp" do app real, mesma proporção do ajuste já feito na conversa aberta (TASK-0164).
            TASK-0301 (pedido direto): o logo agora é clicável e volta pro
            Atendimento — desde que "Conversas" saiu do menu superior (vira
            a tela padrão do sistema), sem isso quem navegasse pra
            Crescimento/Configurar/Empresas não teria mais nenhum jeito de
            voltar pro atendimento pelo cabeçalho. */}
        <button type="button" onClick={() => selectTab('whatsapp')} className="flex min-w-0 items-center gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70" title={isSpanish ? 'Ir a Atención' : 'Ir para o Atendimento'}><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><MessageSquare className="w-5 h-5" /></div><span className="truncate text-lg font-bold text-white">Universo</span></button>
        <div className="flex items-center gap-1.5"><button type="button" onClick={() => setLanguage(language === 'pt' ? 'es' : 'pt')} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200" title={isSpanish ? 'Português' : 'Español'}>{isSpanish ? 'PT' : 'ES'}</button>{renderThemeMenu('mobile')}<button type="button" onClick={() => { setIsMobileMenuOpen((value) => !value); setOpenToolsMenu(null); setIsMobileTenantMenuOpen(false); }} className="rounded-md p-1.5 text-slate-200 hover:bg-slate-800" title={copy.menu}>{isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button></div>
      </div>
      {isMobileMenuOpen && (
        <>
          {/* TASK-0195: fecha ao tocar fora do menu — este menu nunca teve
              esse listener (achado real lendo o código), diferente de todo
              outro menu deste arquivo. z-index abaixo do painel (z-20 <
              z-30) e abaixo do header (que continua z-30, sempre clicável
              por cima do backdrop, inclusive o próprio botão que abriu o
              menu). TASK-0289 (pedido direto, print real): véu ganha cor
              (antes 100% transparente, só existia pra capturar o toque de
              "fechar fora") — escurece a lista de conversas atrás, sem
              escondê-la de verdade, igual uma gaveta de verdade (o menu
              deixou de empurrar o conteúdo pra baixo, ver o wrapper
              abaixo). */}
          <div className="fixed inset-0 z-20 bg-slate-950/60 md:hidden" onClick={() => setIsMobileMenuOpen(false)} aria-hidden="true" />
          {/* TASK-0289 (pedido direto, print real): "abre o menu como uma
              gaveta... sem esconder os itens de baixo" — antes este menu
              era conteúdo INLINE (`relative`) que empurrava a lista de
              conversas pra baixo da tela, deixando um vazio visível no
              meio do caminho. Agora é `absolute` ancorado no fim do
              `<header>` (`top-full` — o header é `position: sticky`, que
              estabelece bloco de contenção pra posicionamento absoluto
              igual `relative` faria, então isso funciona sem precisar
              calcular a altura do cabeçalho em pixel), flutuando por cima
              da lista de conversas (só o véu acima escurece o que fica
              embaixo). `max-h-[85vh] overflow-y-auto` evita estourar a
              tela em telas baixas com muito conteúdo. */}
          <div
            className="mobile-nav-menu absolute inset-x-0 top-full z-30 max-h-[85vh] overflow-y-auto animate-page-enter border-t border-slate-800 bg-slate-900 pb-3 pt-2 shadow-2xl md:hidden"
            onTouchStart={handleMobileMenuTouchStart}
            onTouchEnd={handleMobileMenuTouchEnd}
          >
            {/* TASK-0195: rótulo de seção — o mesmo padrão já usado abaixo
                pra "Empresa ativa", pra deixar claro onde a navegação
                termina e os controles de conta começam (antes tudo tinha o
                mesmo peso visual, sem nenhuma divisão). */}
            <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{isSpanish ? 'Navegación' : 'Navegação'}</p>
            <div className="mobile-nav-menu__items flex flex-col gap-1.5 pb-1.5">{primaryNavigation.map(renderTab)}{renderToolsMenu('configuration', 'mobile', copy.configure, configurationNavigation, isConfigurationActive)}{saasNavigation.map(renderTab)}</div>
        <div className="relative mt-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" ref={mobileTenantMenuRef}>
          <div className="flex items-center justify-between gap-2">
            {canSeeSaasMaster && tenants.length > 1 ? (
              <button
                type="button"
                onClick={() => setIsMobileTenantMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={isMobileTenantMenuOpen}
                aria-controls="mobile-active-tenant-menu"
                aria-label={`${copy.activeCompany}: ${activeTenant.name}`}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md text-left touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
              >
                <span className="min-w-0"><span className="block text-[10px] text-slate-500">{copy.activeCompany}</span><span className="block truncate text-xs font-semibold text-slate-200">{activeTenant.name}</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isMobileTenantMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            ) : (
              <div className="min-w-0"><p className="text-[10px] text-slate-500">{copy.activeCompany}</p><p className="truncate text-xs font-semibold text-slate-200">{activeTenant.name}</p></div>
            )}
            {currentUser ? <button type="button" onClick={onLogout} className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-rose-300"><LogOut className="w-3.5 h-3.5" />{copy.signOut}</button> : <button type="button" onClick={onOpenLoginModal} className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-emerald-300"><User className="w-3.5 h-3.5" />{copy.signIn}</button>}
          </div>
          {canSeeSaasMaster && tenants.length > 1 && isMobileTenantMenuOpen && (
            <div id="mobile-active-tenant-menu" className="mt-2 space-y-1 border-t border-slate-800 pt-2" role="menu" aria-label={copy.activeCompany}>
              <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{copy.activeCompany}</p>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    type="button"
                    role="menuitem"
                    onClick={() => { onSelectTenant(tenant); setIsMobileTenantMenuOpen(false); setIsMobileMenuOpen(false); }}
                    className={`flex min-h-10 w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${tenant.id === activeTenant.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    <span className="truncate">{tenant.name}</span>
                    {tenant.id === activeTenant.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* TASK-0289 (pedido direto, print real): "Notificações Push"
              tinha caixa própria (mesmo peso visual de "Empresa
              ativa"/"Modo visual", 3 caixas empilhadas) — vira sub-linha
              discreta aqui dentro, mesmo padrão `border-t` já usado acima
              pra separar a lista de tenants sem abrir outra caixa. Continua
              funcional (mesmo `togglePush`/`pushEnabled`/`pushBusy` de
              antes, TASK-0284) — só menos destacada, não removida (recurso
              real, único lugar do app que liga/desliga push hoje). */}
          {currentUser && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
              <span className="text-[10px] text-slate-500">{isSpanish ? 'Notificaciones push' : 'Notificações push'}</span>
              <button
                type="button"
                onClick={() => void togglePush()}
                disabled={pushBusy}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold transition-colors disabled:opacity-50 ${pushEnabled ? 'text-emerald-300' : 'text-slate-400 hover:text-white'}`}
              >
                {pushEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                {pushBusy ? '...' : pushEnabled ? (isSpanish ? 'Activas' : 'Ativas') : (isSpanish ? 'Activar' : 'Ativar')}
              </button>
            </div>
          )}
        </div>
          </div>
        </>
      )}
      {/* TASK unificação (pedido direto, 04/09/2026): as duas fileiras
          desktop (título+subtítulo+ícones numa linha, abas numa segunda
          linha separada por border-t) viraram uma única fileira de ~56px
          pra ganhar altura vertical na tela de Atendimento — o subtítulo
          (`copy.subtitle`) saiu porque não cabia mais numa linha só; o
          título abreviado + ícone continuam à esquerda, só que agora
          compactos e sem quebrar em duas linhas. */}
      <div className="hidden items-center gap-3 py-2.5 md:flex">
        <button type="button" onClick={() => selectTab('whatsapp')} className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70" title={isSpanish ? 'Ir a Atención' : 'Ir para o Atendimento'}><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-inner"><MessageSquare className="w-4 h-4" /></div><h1 className="hidden truncate text-sm font-bold tracking-tight text-white lg:block">{copy.platform}</h1></button>
        <button type="button" onClick={() => scrollTabs('left')} className="shrink-0 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-300" title={copy.previous}><ChevronLeft className="w-4 h-4" /></button>
        <div ref={tabsRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth py-0.5">{primaryNavigation.map(renderTab)}{renderToolsMenu('configuration', 'desktop', copy.configure, configurationNavigation, isConfigurationActive)}{saasNavigation.map(renderTab)}</div>
        <button type="button" onClick={() => scrollTabs('right')} className="shrink-0 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-300" title={copy.next}><ChevronRight className="w-4 h-4" /></button>
        <div className="flex shrink-0 items-center gap-2">{/* TASK-0225: ícone de Pendências (escalonamento), pedido direto do dono do produto — "coloca do lado do seletor de idioma". Antes vivia só na barra de ferramentas exclusiva de desktop do Atendimento (removida na mesma tarefa) e na `.atendimento-bottom-nav` mobile; aqui fica sempre visível, em qualquer aba, sem depender de ter uma conversa aberta. Mesmo gate de capability (`canSeeConversations`, já calculado acima) que decide se a aba "Conversas" aparece no menu. */}{canSeeConversations && <button type="button" onClick={() => setActiveTab('escalations')} className="relative rounded-lg border border-slate-700 bg-slate-950 p-2 text-[var(--pending)] transition-colors hover:bg-slate-800" title="Pendências">
          <AlertTriangle className="w-4 h-4" />
          {escalationsPendingCount > 0 && <span className="absolute -top-1 -right-1 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">{escalationsPendingCount}</span>}
        </button>}<div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label="Idioma"><button type="button" onClick={() => setLanguage('pt')} className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${language === 'pt' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>PT</button><button type="button" onClick={() => setLanguage('es')} className={`rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${language === 'es' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>ES</button></div>{renderThemeMenu('desktop')}{currentUser && <button type="button" onClick={onOpenChangePasswordModal} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white" title="Trocar minha senha"><KeyRound className="w-4 h-4" /></button>}{currentUser && <button type="button" onClick={() => void togglePush()} disabled={pushBusy} className={`rounded-lg border p-2 transition-colors disabled:opacity-50 ${pushEnabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15' : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white'}`} title={pushEnabled ? 'Desativar notificações push neste dispositivo' : 'Ativar notificações push (escalação nova, agente pausado com lead sem resposta)'}>{pushEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}</button>}{currentUser ? <div className="relative" ref={profileMenuRef}><button type="button" onClick={() => currentUser.role === 'saas_admin' ? setIsProfileMenuOpen((value) => !value) : onOpenLoginModal()} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 p-1.5 pl-2.5 text-left text-slate-200 transition-colors hover:bg-slate-800"><img src={currentUser.avatar} alt={currentUser.name} className="h-7 w-7 rounded-full border border-emerald-500/50 object-cover" /><span className="hidden max-w-28 truncate text-xs font-bold text-white lg:block">{currentUser.name}</span><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`} /></button>{currentUser.role === 'saas_admin' && isProfileMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{copy.activeCompany}</p><div className="max-h-56 space-y-1 overflow-y-auto">{tenants.map((tenant) => <button key={tenant.id} type="button" onClick={() => { onSelectTenant(tenant); setIsProfileMenuOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${tenant.id === activeTenant.id ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-300 hover:bg-slate-800'}`}><span className="truncate">{tenant.name}</span>{tenant.id === activeTenant.id && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}</button>)}</div><button type="button" onClick={() => { setIsProfileMenuOpen(false); onOpenLoginModal(); }} className="mt-2 w-full border-t border-slate-800 px-2.5 pt-2 text-left text-xs font-medium text-slate-300 hover:text-white">{copy.changeOperator}</button></div>}</div> : <button type="button" onClick={onOpenLoginModal} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400"><User className="w-4 h-4" />{copy.signIn}</button>}{currentUser && <button type="button" onClick={onLogout} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300" title={copy.signOut}><LogOut className="w-4 h-4" /></button>}</div>
      </div>
    </div>
  </header>;
};
