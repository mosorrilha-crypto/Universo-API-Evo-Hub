/**
 * Issue #124 — usa a escala nomeada de raio (rounded-control/panel/pill,
 * ver @theme em src/index.css) como referência de como código novo deve
 * escrever isso. Mapeada 1:1 pro valor que rounded-lg/xl/full já tinham
 * aqui — zero mudança visual, só a intenção explícita no JSX.
 *
 * Issue #125 — os botões mais simples deste arquivo (menu mobile, scroll
 * da faixa de abas, entrar/sair) usam o componente <Button> como
 * referência de adoção (foco visível padronizado, que praticamente
 * nenhum botão do painel tinha antes). As abas de navegação (com cor
 * ativa própria por papel — roxo pro SaaS Admin, esmeralda pro resto)
 * continuam com a classe condicional manual: o `active` do <Button> hoje
 * só cobre um tom (esmeralda), não encaixa nesse caso sem estender o
 * componente — fica como próximo passo, não bloqueia esta adoção inicial.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import { isStandalonePwa } from '../lib/pwa';
import { hasRoleAtLeast } from '../lib/roles';
import { Button } from './ui/Button';
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  Brain,
  Target,
  Kanban,
  DollarSign,
  User,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  Layers,
  CalendarDays,
  X,
  Menu
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
  const tabsRef = useRef<HTMLDivElement>(null);
  // Duas restrições combinadas nas abas visíveis: (1) aberto pelo ícone
  // instalado (PWA do atendente, issue #159) sempre restringe pro escopo de
  // atendimento, não importa o papel do usuário; (2) papel "Operador" fica
  // restrito ao mesmo escopo mesmo no navegador normal — pedido direto do
  // Lucas: funcionário de atendimento não deve ver Financeiro nem telas
  // administrativas. "Gerente" já enxerga Financeiro, mas só
  // "Administrador"+ vê as ferramentas mais técnicas (Meta CAPI, Base de
  // Conhecimento, Evo Hub, Guia de API), e só "SaaS Master Admin" vê o
  // painel multi-tenant. display-mode não muda durante a sessão, então um
  // cálculo só (não precisa reavaliar em cada render) já é suficiente.
  const [isInstalledApp] = useState(() => isStandalonePwa());
  const canSeeFinancial = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'manager');
  const canSeeAdminTools = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'admin');
  const canSeeSaasMaster = !isInstalledApp && hasRoleAtLeast(currentUser?.role, 'saas_admin');
  // Achado real testando no celular (Lucas): o cabeçalho completo (marca +
  // seletor de empresa + perfil, cada um sua própria "caixa") empilhava em
  // 3 blocos cheios antes de qualquer conteúdo útil aparecer na tela. No
  // mobile, tudo isso agora fica atrás de um botão de menu — no desktop
  // (md:) o layout original continua igual, sem essa condensação.
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Achado direto do dono do produto (19/08/2026): o seletor de empresa
  // (Building2 + dropdown próprio) e o menu do perfil (setinha ▼ + botão
  // Sair) eram dois controles lado a lado fazendo coisas parecidas —
  // confuso. Unificados num só: a setinha do perfil agora abre um dropdown
  // que, só pra saas_admin, também lista as empresas pra alternar de
  // verdade (backend já resolve isso via header X-Tenant-Id, ver
  // resolveTenantId em server/middleware/rbac.ts — não é mais cosmético).
  // Pra quem não é saas_admin, a setinha continua abrindo direto o modal de
  // login (nada pra listar), sem esse dropdown extra.
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Mesmo raciocínio da versão antiga do seletor de empresa: fecha ao
  // clicar fora, não só no hover (não depende de trajetória do mouse e
  // também funciona em touch).
  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = direction === 'left' ? -280 : 280;
      tabsRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Barra compacta só no mobile: ícone + título curto + status +
            botão de menu, tudo numa linha só. O bloco completo (marca,
            seletor de empresa, perfil) fica escondido atrás do menu — ver
            painel logo abaixo — pra não empilhar 3 caixas grandes antes de
            qualquer conteúdo real aparecer na tela pequena. */}
        <div className="flex md:hidden items-center justify-between py-3">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-8 h-8 rounded-control bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="font-bold text-white text-sm truncate">Universo</span>
          </div>
          <Button variant="ghost" size="md" iconOnly onClick={() => setIsMobileMenuOpen((open) => !open)} title="Menu" className="flex-shrink-0">
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden pb-4 space-y-3 border-t border-slate-800/80 pt-3 animate-pop-in origin-top">
            <p className="text-xs text-slate-400">
              Plataforma Multi-Empresas de Inteligência de Atendimento, CRM, Financeiro e CAPI
            </p>

            {currentUser?.role === 'saas_admin' ? (
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-1">Empresa ativa</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {tenants.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { onSelectTenant(t); setIsMobileMenuOpen(false); }}
                      className={`w-full text-left px-2.5 py-2 rounded-control text-xs font-medium flex items-center justify-between transition-all ${
                        t.id === activeTenant.id
                          ? 'bg-emerald-950/80 text-emerald-300 font-bold border border-emerald-800/50'
                          : 'text-slate-300 bg-slate-950 border border-slate-800'
                      }`}
                    >
                      <span className="truncate pr-2">{t.name}</span>
                      {t.id === activeTenant.id && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-control bg-slate-950 border border-slate-800 text-slate-300" title={activeTenant.name}>
                <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="font-semibold text-xs truncate">{activeTenant.name}</span>
              </div>
            )}

            {/* Painel Multi-Tenant saiu da faixa de abas (pedido direto,
                19/08/2026: Atendimento é a página principal) — vira um botão
                próprio, só pra quem já enxergava a aba (saas_admin). */}
            {canSeeSaasMaster && (
              <Button
                active={activeTab === 'saas'}
                size="md"
                onClick={() => { setActiveTab('saas'); setIsMobileMenuOpen(false); }}
                className="w-full justify-center"
              >
                <Layers className="w-4 h-4" />
                <span>Painel Multi-Tenant</span>
              </Button>
            )}

            {currentUser ? (
              <div className="flex items-center justify-between bg-slate-800/90 border border-slate-700/80 p-2 rounded-panel text-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-pill object-cover border border-emerald-500/50 flex-shrink-0" />
                  <div className="text-left min-w-0">
                    <div className="font-bold text-white text-xs leading-none truncate">{currentUser.name}</div>
                    <div className="text-[10px] text-emerald-400 capitalize">{currentUser.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="sm" iconOnly onClick={() => { onOpenLoginModal(); setIsMobileMenuOpen(false); }} title="Trocar Operador / Perfil">
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                  <Button variant="danger" size="sm" iconOnly onClick={() => { onLogout(); setIsMobileMenuOpen(false); }} title="Sair">
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="primary" size="md" onClick={() => { onOpenLoginModal(); setIsMobileMenuOpen(false); }} className="w-full">
                <User className="w-4 h-4" />
                <span>Entrar / Login</span>
              </Button>
            )}
          </div>
        )}

        {/* Layout original — só no desktop (md:) a partir daqui, sem
            nenhuma mudança de comportamento pra quem já usava assim. */}
        <div className="hidden md:flex md:items-center md:justify-between py-4 gap-4">

          {/* Brand & App Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-panel bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                SaaS Multi-Tenant <span className="text-emerald-400">WhatsApp & Meta CAPI</span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Plataforma Multi-Empresas de Inteligência de Atendimento, CRM, Financeiro e CAPI
              </p>
            </div>
          </div>

          {/* Tenant Switcher & User Auth */}
          <div className="flex items-center space-x-3 text-xs">

            {/* Empresa ativa — só texto informativo pra quem não é
                saas_admin (sempre dono de UM tenant só, nada pra trocar).
                Pra saas_admin, a troca de verdade agora mora no dropdown do
                perfil (ver abaixo). */}
            {currentUser?.role !== 'saas_admin' && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-300" title={activeTenant.name}>
                <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="font-semibold text-xs truncate max-w-[140px]">{activeTenant.name}</span>
              </div>
            )}

            {/* Painel Multi-Tenant saiu da faixa de abas (pedido direto,
                19/08/2026: Atendimento é a página principal) — vira um botão
                próprio, só pra quem já enxergava a aba (saas_admin). */}
            {canSeeSaasMaster && (
              <Button
                active={activeTab === 'saas'}
                size="sm"
                onClick={() => setActiveTab('saas')}
                title="Painel Multi-Tenant"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Painel</span>
              </Button>
            )}

            {/* User Profile */}
            {currentUser ? (
              <div className="relative" ref={profileMenuRef}>
                <div className="flex items-center space-x-2 bg-slate-800/90 border border-slate-700/80 p-1.5 pl-2.5 rounded-panel text-slate-200">
                  <img
                    src={currentUser.avatar}
                    alt={currentUser.name}
                    className="w-7 h-7 rounded-pill object-cover border border-emerald-500/50"
                  />
                  <div className="text-left hidden sm:block">
                    <div className="font-bold text-white text-xs leading-none">{currentUser.name}</div>
                    <div className="text-[10px] text-emerald-400 capitalize">{currentUser.role}</div>
                  </div>

                  <Button
                    variant="ghost"
                    size="xs"
                    iconOnly
                    onClick={() => (currentUser.role === 'saas_admin' ? setIsProfileMenuOpen((open) => !open) : onOpenLoginModal())}
                    title={currentUser.role === 'saas_admin' ? 'Alternar empresa / Trocar operador' : 'Trocar Operador / Perfil'}
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
                  </Button>

                  <Button variant="danger" size="xs" iconOnly onClick={onLogout} title="Sair" className="ml-1">
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>

                {/* Dropdown só existe pra saas_admin (único papel com algo
                    real pra listar aqui) — resto continua com o clique
                    direto na setinha abrindo o modal de login, como sempre. */}
                {currentUser.role === 'saas_admin' && isProfileMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-800 rounded-panel shadow-2xl p-2 z-50 origin-top-right animate-pop-in">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-800 mb-1">
                      Alternar Cliente (Tenant)
                    </div>
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {tenants.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            onSelectTenant(t);
                            setIsProfileMenuOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-control text-xs font-medium flex items-center justify-between transition-all ${
                            t.id === activeTenant.id
                              ? 'bg-emerald-950/80 text-emerald-300 font-bold border border-emerald-800/50'
                              : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <div className="truncate">{t.name}</div>
                            <div className="text-[9px] text-slate-500 font-normal">R$ {t.monthlyMRR}/mês • {t.plan}</div>
                          </div>
                          {t.id === activeTenant.id && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-slate-800 mt-2 pt-2">
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onOpenLoginModal();
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-control text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                      >
                        Trocar Operador / Perfil
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Button variant="primary" size="md" onClick={onOpenLoginModal}>
                <User className="w-4 h-4" />
                <span>Entrar / Login</span>
              </Button>
            )}
          </div>

        </div>

        {/* Navigation Tabs with Horizontal Scroll Controls */}
        <div className="relative flex items-center border-t border-slate-800/80 mt-1 pt-1">
          {/* Scroll Left Button */}
          <button
            onClick={() => scrollTabs('left')}
            className="flex-shrink-0 p-1.5 mr-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-control transition-all border border-slate-800 shadow bg-slate-900/90"
            title="Rolar menu para esquerda"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Scrollable Tabs Container */}
          <div
            ref={tabsRef}
            className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto pb-2 pt-0.5 custom-scrollbar scroll-smooth w-full"
          >
            {/* Painel Multi-Tenant saiu da faixa de abas (pedido direto,
                19/08/2026) — agora é um botão próprio no cabeçalho (ver
                acima, junto do seletor de empresa), não mais uma aba aqui.
                Atendimento (WhatsApp, abaixo) passa a ser a página
                principal. */}

            <button
              id="tab-whatsapp-sim"
              onClick={() => setActiveTab('whatsapp')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-control text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'whatsapp'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              {/* Achado real: "Atendimento WhatsApp" ocupava espaço extra numa
                  faixa de abas que já precisa de rolagem horizontal no
                  mobile — o ícone de balão de mensagem já deixa o contexto
                  claro, mesmo padrão do título encurtado dentro da própria
                  tela (WhatsAppLeadsSim.tsx). */}
              <span>WhatsApp</span>
            </button>

            <button
              id="tab-crm"
              onClick={() => setActiveTab('crm')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-control text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'crm'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Kanban className="w-4 h-4 text-emerald-400" />
              <span>CRM</span>
            </button>

            {/* Sem aba própria de propósito (pedido do Lucas): já existe um
                botão "Escalonamentos" com o mesmo badge de contagem dentro
                do próprio Atendimento WhatsApp (toolbar de
                WhatsAppLeadsSim.tsx, via onGoToEscalations) — deixava o
                menu redundante, ainda mais apertado no mobile. */}

            {canSeeFinancial && (
              <button
                id="tab-agenda-financeiro"
                onClick={() => setActiveTab('agenda_financeiro')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-control text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'agenda_financeiro'
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <CalendarDays className="w-4 h-4 text-emerald-400" />
                <span>Agenda &amp; Financeiro</span>
              </button>
            )}

            {canSeeAdminTools && (
              <>
                <button
                  id="tab-attribution"
                  onClick={() => setActiveTab('attribution')}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-control text-sm font-medium transition-all whitespace-nowrap ${
                    activeTab === 'attribution'
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Target className="w-4 h-4 text-emerald-400" />
                  <span>Meta CAPI</span>
                </button>

                <button
                  id="tab-knowledge"
                  onClick={() => setActiveTab('knowledge')}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-control text-sm font-medium transition-all whitespace-nowrap ${
                    activeTab === 'knowledge'
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Brain className="w-4 h-4 text-emerald-400" />
                  <span>Base de Conhecimento</span>
                </button>

                {/* "Guia Conexão API" removida da navegação (pedido direto,
                    "pode descartar"/"não é necessário no momento") — a tela
                    continua existindo no código, só não tem mais aba
                    própria; reativar é só devolver o botão aqui. A integração
                    "Evo Hub" (api.evohub.ai) que também tinha aba aqui foi
                    descontinuada de vez e removida do código. */}
              </>
            )}
          </div>

          {/* Scroll Right Button */}
          <button
            onClick={() => scrollTabs('right')}
            className="flex-shrink-0 p-1.5 ml-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-control transition-all border border-slate-800 shadow bg-slate-900/90"
            title="Rolar menu para direita"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
