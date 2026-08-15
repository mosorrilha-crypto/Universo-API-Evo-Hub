import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import { isStandalonePwa } from '../lib/pwa';
import { hasRoleAtLeast } from '../lib/roles';
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
  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);
  const tenantMenuRef = useRef<HTMLDivElement>(null);

  // Achado numa auditoria pós-lançamento: o seletor de empresa abria só no
  // hover (group-hover:block) — o gap entre o botão e o menu (mt-1.5) não
  // faz parte da área "hoverável" de nenhum dos dois elementos, então mover
  // o mouse na diagonal em direção ao menu passava por esse vão e fechava o
  // menu antes de dar tempo de clicar numa empresa. Trocado pra clique, que
  // não depende de trajetória do mouse e também funciona em touch.
  useEffect(() => {
    if (!isTenantMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (tenantMenuRef.current && !tenantMenuRef.current.contains(event.target as Node)) {
        setIsTenantMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isTenantMenuOpen]);

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
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="font-bold text-white text-sm truncate">Universo</span>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all flex-shrink-0"
            title="Menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
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
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
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
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300" title={activeTenant.name}>
                <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="font-semibold text-xs truncate">{activeTenant.name}</span>
              </div>
            )}

            {currentUser ? (
              <div className="flex items-center justify-between bg-slate-800/90 border border-slate-700/80 p-2 rounded-xl text-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover border border-emerald-500/50 flex-shrink-0" />
                  <div className="text-left min-w-0">
                    <div className="font-bold text-white text-xs leading-none truncate">{currentUser.name}</div>
                    <div className="text-[10px] text-emerald-400 capitalize">{currentUser.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { onOpenLoginModal(); setIsMobileMenuOpen(false); }}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                    title="Trocar Operador / Perfil"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { onLogout(); setIsMobileMenuOpen(false); }}
                    className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-all"
                    title="Sair"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { onOpenLoginModal(); setIsMobileMenuOpen(false); }}
                className="w-full px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-xl flex items-center justify-center space-x-1.5 shadow"
              >
                <User className="w-4 h-4" />
                <span>Entrar / Login</span>
              </button>
            )}
          </div>
        )}

        {/* Layout original — só no desktop (md:) a partir daqui, sem
            nenhuma mudança de comportamento pra quem já usava assim. */}
        <div className="hidden md:flex md:items-center md:justify-between py-4 gap-4">

          {/* Brand & App Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
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

            {/* Active Tenant Selector Dropdown — achado a pedido do dono do
                tenant: essa troca é só cosmética hoje (toda rota real do
                backend já resolve o tenant pelo tenantId do próprio JWT
                autenticado, nunca por essa seleção da UI), mas mesmo assim
                não faz sentido nenhum um operador comum (role admin/
                operator/manager, sempre dono de UM tenant só) ver ou trocar
                entre OUTRAS empresas — só confunde. "Alternar Cliente" fica
                restrito a quem é saas_admin de verdade (o dono da
                plataforma, gerenciando múltiplos clientes); qualquer outro
                perfil só vê o nome da própria empresa, sem dropdown. */}
            {currentUser?.role === 'saas_admin' ? (
              <div className="relative" ref={tenantMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsTenantMenuOpen((open) => !open)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer transition-all"
                  title={`Empresa ativa: ${activeTenant.name} — clique pra trocar`}
                >
                  <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="font-semibold text-xs truncate max-w-[140px]">{activeTenant.name}</span>
                  <ChevronDown className={`w-3 h-3 text-slate-500 flex-shrink-0 transition-transform ${isTenantMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown menu — ancora pela esquerda no mobile (o botão fica perto
                    da borda esquerda no layout empilhado) e pela direita no desktop
                    (linha única, botão perto da borda direita) — evita vazar pra fora
                    da tela nos dois casos. */}
                {isTenantMenuOpen && (
                  <div className="absolute left-0 md:left-auto md:right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-2 z-50 origin-top-left md:origin-top-right animate-pop-in">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-800 mb-1">
                      Alternar Cliente (Tenant)
                    </div>
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {tenants.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            onSelectTenant(t);
                            setIsTenantMenuOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
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
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-300" title={activeTenant.name}>
                <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="font-semibold text-xs truncate max-w-[140px]">{activeTenant.name}</span>
              </div>
            )}

            {/* User Profile */}
            {currentUser ? (
              <div className="flex items-center space-x-2 bg-slate-800/90 border border-slate-700/80 p-1.5 pl-2.5 rounded-xl text-slate-200">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-7 h-7 rounded-full object-cover border border-emerald-500/50"
                />
                <div className="text-left hidden sm:block">
                  <div className="font-bold text-white text-xs leading-none">{currentUser.name}</div>
                  <div className="text-[10px] text-emerald-400 capitalize">{currentUser.role}</div>
                </div>

                <button
                  onClick={onOpenLoginModal}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                  title="Trocar Operador / Perfil"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>

                <button
                  onClick={onLogout}
                  className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-all ml-1"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenLoginModal}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-xl flex items-center space-x-1.5 shadow"
              >
                <User className="w-4 h-4" />
                <span>Entrar / Login</span>
              </button>
            )}
          </div>

        </div>

        {/* Navigation Tabs with Horizontal Scroll Controls */}
        <div className="relative flex items-center border-t border-slate-800/80 mt-1 pt-1">
          {/* Scroll Left Button */}
          <button
            onClick={() => scrollTabs('left')}
            className="flex-shrink-0 p-1.5 mr-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-all border border-slate-800 shadow bg-slate-900/90"
            title="Rolar menu para esquerda"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Scrollable Tabs Container */}
          <div
            ref={tabsRef}
            className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto pb-2 pt-0.5 custom-scrollbar scroll-smooth w-full"
          >
            {canSeeSaasMaster && (
              <button
                id="tab-saas-admin"
                onClick={() => setActiveTab('saas')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'saas'
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50'
                    : 'text-purple-300 hover:text-white hover:bg-purple-950/40 border border-purple-800/40'
                }`}
              >
                <Layers className="w-4 h-4 text-purple-300" />
                <span>Painel</span>
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/30 text-purple-200 font-bold">
                  Multi-Tenant
                </span>
              </button>
            )}

            <button
              id="tab-whatsapp-sim"
              onClick={() => setActiveTab('whatsapp')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
                id="tab-financial"
                onClick={() => setActiveTab('financial')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'financial'
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Financeiro</span>
              </button>
            )}

            {canSeeAdminTools && (
              <>
                <button
                  id="tab-attribution"
                  onClick={() => setActiveTab('attribution')}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    activeTab === 'knowledge'
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Brain className="w-4 h-4 text-emerald-400" />
                  <span>Base de Conhecimento</span>
                </button>

                {/* "Evo Hub (Meta API)" e "Guia Conexão API" removidas da
                    navegação (pedido direto, "pode descartar"/"não é
                    necessário no momento") — as telas (EvoHubIntegration.tsx
                    e o guia) continuam existindo no código, só não têm mais
                    aba própria; reativar é só devolver os dois botões aqui. */}
              </>
            )}
          </div>

          {/* Scroll Right Button */}
          <button
            onClick={() => scrollTabs('right')}
            className="flex-shrink-0 p-1.5 ml-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-all border border-slate-800 shadow bg-slate-900/90"
            title="Rolar menu para direita"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
