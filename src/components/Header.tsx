import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Tenant, UserProfile } from '../types';
import {
  MessageSquare,
  Code,
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
  Database,
  Trash2,
  RotateCcw,
  Download,
  X,
  Zap,
  AlertTriangle
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
  onClearAllMockData?: () => void;
  onLoadDemoData?: () => void;
  onExportBackup?: () => void;
  leadsCount?: number;
  transactionsCount?: number;
  escalationsPendingCount?: number;
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
  onClearAllMockData,
  onLoadDemoData,
  onExportBackup,
  leadsCount = 0,
  transactionsCount = 0,
  escalationsPendingCount = 0
}) => {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
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

  const isCleanProduction = leadsCount === 0 && transactionsCount === 0;

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between py-4 gap-4">
          
          {/* Brand & App Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  SaaS Multi-Tenant <span className="text-emerald-400">WhatsApp & Meta CAPI</span>
                </h1>
                <button
                  onClick={() => setIsDataModalOpen(true)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                    isCleanProduction
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900'
                      : 'bg-amber-950/80 text-amber-300 border-amber-700/60 hover:bg-amber-900'
                  }`}
                  title="Clique para gerenciar dados fictícios e modo de produção"
                >
                  <Database className="w-3 h-3 mr-1 text-emerald-400" />
                  {isCleanProduction ? 'Ambiente Limpo (Produção)' : 'Dados de Teste Ativos'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Plataforma Multi-Empresas de Inteligência de Atendimento, CRM, Financeiro e CAPI
              </p>
            </div>
          </div>

          {/* Tenant Switcher, Data Management & User Auth */}
          <div className="flex items-center space-x-3 text-xs">
            
            {/* Quick Data Management Button */}
            <button
              onClick={() => setIsDataModalOpen(true)}
              className="hidden lg:flex items-center space-x-1.5 bg-slate-950 border border-slate-800 hover:border-emerald-500/50 p-2 px-3 rounded-xl text-slate-300 hover:text-white transition-all"
              title="Limpar dados fictícios ou exportar backup"
            >
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-xs">Clientes Reais / Dados</span>
            </button>

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
                  <div className="absolute left-0 md:left-auto md:right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-2 z-50">
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
              <span>Painel SaaS Master</span>
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/30 text-purple-200 font-bold">
                Multi-Tenant
              </span>
            </button>

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
              <span>Atendimento WhatsApp</span>
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
              <span>CRM do Operador</span>
            </button>

            <button
              id="tab-escalations"
              onClick={() => setActiveTab('escalations')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'escalations'
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-900/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Escalonamentos</span>
              {escalationsPendingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500 text-white font-bold">
                  {escalationsPendingCount}
                </span>
              )}
            </button>

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
              <span>Financeiro & Vendas</span>
            </button>

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
              <span>Atribuição Meta CAPI</span>
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

            <button
              id="tab-evohub"
              onClick={() => setActiveTab('evohub')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'evohub'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50'
                  : 'text-purple-300 hover:text-white hover:bg-purple-950/40 border border-purple-800/40'
              }`}
            >
              <Zap className="w-4 h-4 text-purple-400" />
              <span>Evo Hub (Meta API)</span>
            </button>

            <button
              id="tab-integration"
              onClick={() => setActiveTab('integration')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'integration'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Code className="w-4 h-4 text-emerald-400" />
              <span>Guia Conexão API</span>
            </button>
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

      {/* Data Management & Production Preparation Modal */}
      {isDataModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Preparar Ambiente & Gestão de Dados</h2>
                  <p className="text-xs text-slate-400">Refinamento do sistema para clientes reais em produção</p>
                </div>
              </div>
              <button
                onClick={() => setIsDataModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Status Overview */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
                <div className="text-slate-400">Leads no CRM</div>
                <div className="text-lg font-bold text-white">{leadsCount} registros</div>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
                <div className="text-slate-400">Faturas Geradas</div>
                <div className="text-lg font-bold text-emerald-400">{transactionsCount} faturas</div>
              </div>
            </div>

            {/* Actions List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Ações de Refinamento</h3>

              {/* Clear All Mock Data */}
              <div className="p-4 bg-rose-950/20 border border-rose-900/50 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-rose-200 flex items-center gap-1.5">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    Limpar Conversas & Dados Fictícios
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Zera todos os leads de teste, transcrições e faturas simuladas. Deixa o sistema 100% pronto para clientes reais.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (onClearAllMockData) onClearAllMockData();
                    setIsDataModalOpen(false);
                  }}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl flex-shrink-0 transition-all shadow"
                >
                  Zerar Canvas
                </button>
              </div>

              {/* Restore Demo Data */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <RotateCcw className="w-4 h-4 text-emerald-400" />
                    Restaurar Dados de Demonstração
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Carrega conversas completas e leads fictícios pré-configurados para apresentar o software a investidores ou clientes.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (onLoadDemoData) onLoadDemoData();
                    setIsDataModalOpen(false);
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex-shrink-0 transition-all"
                >
                  Restaurar Exemplo
                </button>
              </div>

              {/* Export JSON Backup */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-purple-400" />
                    Exportar Backup Completo (JSON)
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Baixa um arquivo com todos os dados cadastrados (empresas, leads, faturas e base de conhecimento).
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (onExportBackup) onExportBackup();
                  }}
                  className="px-3.5 py-2 bg-purple-900/60 hover:bg-purple-800 border border-purple-700 text-purple-200 font-bold text-xs rounded-xl flex-shrink-0 transition-all"
                >
                  Baixar Backup
                </button>
              </div>
            </div>

            {/* Checklist Box */}
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs space-y-1.5">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-emerald-400" />
                Checklist de Veiculação Comercial
              </div>
              <ul className="text-[11px] text-slate-300 space-y-1 list-disc pl-4">
                <li>Defina a URL do Webhook do WhatsApp no Evolution API / Z-API</li>
                <li>Adicione seu ID do Pixel da Meta e Token no painel de Atribuição CAPI</li>
                <li>Certifique-se de que a variável GEMINI_API_KEY esteja configurada no backend</li>
              </ul>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsDataModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
