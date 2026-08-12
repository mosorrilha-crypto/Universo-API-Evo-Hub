import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Tenant, TenantPlan, TenantStatus, UserProfile, UserRole, TenantTokenTelemetry, QueueSystemStatus } from '../types';
import { INITIAL_TENANTS } from '../data/mockTenants';
import { apiFetch } from '../lib/apiClient';

const PLAN_DISTRIBUTION = [
  { name: 'Starter (R$ 590)', value: 12, color: '#10b981' },
  { name: 'Pro (R$ 1.200)', value: 20, color: '#a855f7' },
  { name: 'Enterprise (R$ 2.900)', value: 7, color: '#3b82f6' },
];
import {
  Building2,
  DollarSign,
  Users,
  TrendingUp,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Key,
  MessageSquare,
  QrCode,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Settings,
  Layers,
  Copy,
  Zap,
  X,
  PieChart as PieChartIcon,
  Cpu,
  Database,
  RefreshCw,
  Server,
  Activity,
  ToggleLeft,
  ToggleRight,
  FlaskConical
} from 'lucide-react';

interface RealTenant {
  id: string;
  name: string;
  slug: string | null;
}

/**
 * Onboarding real de WhatsApp via Evolution API (Epic 4.6, issue #95) —
 * substitui o antigo `ConfiguracaoCanais`, que era 100% decorativo (chamava
 * `/api/canais/criar`, uma rota que nunca existiu no backend, e abria um
 * link fixo pra `app.evohub.ai`, domínio que também não é real). O fluxo
 * real já existia no backend desde antes (server/routes/admin.ts —
 * POST/GET .../evolution-instance) mas nenhuma tela chamava essas rotas.
 *
 * Achado ao investigar: a lista de tenants desta tela ("Tenants & Conexões"
 * acima) é local/localStorage, igual ao já documentado sobre CRM/Financeiro
 * em CLAUDE.md — criar um tenant ali não grava nada na tabela real
 * `tenants` do Supabase. Esse componente busca a lista REAL (GET
 * /api/admin/tenants) separadamente, e permite criar um tenant real na
 * hora (POST /api/admin/tenants) se o que se quer conectar ainda não
 * existe no banco.
 */
export function ConectarEvolutionQrCode() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [realTenants, setRealTenants] = useState<RealTenant[]>([]);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [newTenantName, setNewTenantName] = useState('');
  const [isCreatingTenant, setIsCreatingTenant] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'waiting' | 'connected'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchRealTenants = async () => {
    setIsLoadingTenants(true);
    try {
      const res = await apiFetch('/api/admin/tenants');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tenants: RealTenant[] = (data.tenants || []).map((t: any) => ({ id: t.id, name: t.name, slug: t.slug }));
      setRealTenants(tenants);
      if (tenants.length && !selectedTenantId) setSelectedTenantId(tenants[0].id);
    } catch (err) {
      console.error('Falha ao carregar tenants reais:', err);
    } finally {
      setIsLoadingTenants(false);
    }
  };

  const openModal = () => {
    setIsModalOpen(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    setConnectionState('idle');
    fetchRealTenants();
  };

  const handleCreateRealTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenantName.trim()) return;
    setIsCreatingTenant(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTenantName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNewTenantName('');
      await fetchRealTenants();
      setSelectedTenantId(data.tenant.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao criar o tenant.');
    } finally {
      setIsCreatingTenant(false);
    }
  };

  // Enquanto aguarda o operador escanear o QR, consulta o estado da conexão
  // a cada 3s — pra tela virar "conectado" sozinha, sem precisar recarregar
  // manualmente pra descobrir se já pareou.
  useEffect(() => {
    if (connectionState !== 'waiting' || !selectedTenantId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/evolution-instance/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.connected) setConnectionState('connected');
      } catch {
        // Falha transitória de rede durante o polling — tenta de novo no próximo tick.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connectionState, selectedTenantId]);

  const handleGenerateQr = async () => {
    if (!selectedTenantId) return;
    setIsGeneratingQr(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/evolution-instance`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // "warning" aqui cobre o caso do webhook não ter sido configurado —
      // a instância/QR estão OK, mas mensagem nenhuma vai chegar até isso
      // ser corrigido (bug real encontrado 12/08/2026), então mostra mesmo
      // sem bloquear o fluxo (o QR continua funcionando pra pareamento).
      if (data.warning) setErrorMsg(data.warning);
      if (data.qrCodeBase64) {
        setQrCodeBase64(data.qrCodeBase64);
        setConnectionState('waiting');
      } else {
        // Instância criada mas a resposta não trouxe QR (varia por versão
        // do servidor Evolution) — busca separadamente, mesma rota que o
        // botão "Gerar novo QR Code" usa.
        await handleRefreshQr();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao gerar o QR Code.');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleRefreshQr = async () => {
    if (!selectedTenantId) return;
    setIsGeneratingQr(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/evolution-instance/qrcode`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setErrorMsg(data.warning);
      setQrCodeBase64(data.qrCodeBase64 || null);
      setConnectionState('waiting');
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao buscar o QR Code.');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 transition-all shadow"
      >
        <QrCode className="w-3.5 h-3.5" />
        Conectar WhatsApp via QR Code
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsModalOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <QrCode className="w-4 h-4 text-purple-400" /> Conectar WhatsApp (Evolution API)
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{errorMsg}</div>
            )}

            {connectionState === 'connected' ? (
              <div className="text-center py-6 space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <p className="text-sm text-white font-semibold">WhatsApp conectado!</p>
                <p className="text-xs text-slate-400">O número já pode receber e enviar mensagens por esse tenant.</p>
              </div>
            ) : qrCodeBase64 ? (
              <div className="text-center space-y-3">
                <img src={qrCodeBase64} alt="QR Code de conexão" className="mx-auto rounded-lg border border-slate-700 w-56 h-56 object-contain bg-white" />
                <p className="text-xs text-slate-400">Abra o WhatsApp no celular do tenant → Aparelhos conectados → Conectar um aparelho → escaneie este código.</p>
                <button
                  type="button"
                  onClick={handleRefreshQr}
                  disabled={isGeneratingQr}
                  className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1.5 mx-auto disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isGeneratingQr ? 'animate-spin' : ''}`} /> QR expirou? Gerar novo
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Tenant a conectar</label>
                  <select
                    value={selectedTenantId}
                    onChange={(e) => setSelectedTenantId(e.target.value)}
                    disabled={isLoadingTenants || !realTenants.length}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    {!realTenants.length && <option value="">{isLoadingTenants ? 'Carregando...' : 'Nenhum tenant cadastrado ainda'}</option>}
                    {realTenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateQr}
                  disabled={!selectedTenantId || isGeneratingQr}
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isGeneratingQr ? <span className="animate-spin">⏳</span> : <QrCode className="w-3.5 h-3.5" />}
                  {isGeneratingQr ? 'Gerando...' : 'Gerar QR Code'}
                </button>

                <div className="pt-2 border-t border-slate-800">
                  <p className="text-[11px] text-slate-500 mb-1.5">Cliente novo? Cadastre o tenant real primeiro:</p>
                  <form onSubmit={handleCreateRealTenant} className="flex gap-2">
                    <input
                      type="text"
                      value={newTenantName}
                      onChange={(e) => setNewTenantName(e.target.value)}
                      placeholder="Nome do tenant"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                    <button
                      type="submit"
                      disabled={!newTenantName.trim() || isCreatingTenant}
                      className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 rounded-xl disabled:opacity-50"
                    >
                      {isCreatingTenant ? '...' : '+ Criar'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
interface SaaSAdminDashboardProps {
  tenants?: Tenant[];
  activeTenant?: Tenant;
  tenantId?: string;
  onSelectTenant?: (tenant: Tenant) => void;
  onAddTenant?: (newTenant: Tenant) => void;
  onUpdateTenant?: (updatedTenant: Tenant) => void;
  currentUser?: UserProfile | any;
}

const MRR_HISTORY_DATA = [
  { month: 'Mar/26', mrr: 18400, clientes: 12 },
  { month: 'Abr/26', mrr: 24900, clientes: 18 },
  { month: 'Mai/26', mrr: 32100, clientes: 24 },
  { month: 'Jun/26', mrr: 41800, clientes: 31 },
  { month: 'Jul/26', mrr: 52400, clientes: 39 },
  { month: 'Ago/26', mrr: 68900, clientes: 48 },
];

export const SaaSAdminDashboard: React.FC<SaaSAdminDashboardProps> = ({
  tenants: propTenants,
  activeTenant: propActiveTenant,
  onSelectTenant,
  onAddTenant,
  onUpdateTenant,
  currentUser,
}) => {
  const tenants = propTenants || INITIAL_TENANTS;
  const activeTenant = propActiveTenant || tenants[0] || INITIAL_TENANTS[0];
  const [searchTerm, setSearchTerm] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [activeAdminTab, setActiveAdminTab] = useState<'tenants' | 'users' | 'tokens_telemetry' | 'roadmap'>('tenants');
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);

  // User Management State — achado real em produção: este painel inteiro
  // era local/localStorage, sem nenhum apiFetch, apesar de já existir uma
  // API real e funcional pra isso (server/routes/admin.ts, GET/POST/DELETE
  // /api/admin/operators, com RBAC de verdade via requireRole). Ligado à API
  // real agora — cria/lista/remove operadores de verdade na tabela
  // `operators`, com login funcional de verdade (senha com hash bcrypt).
  const DEFAULT_USER_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('operator');
  const [newUserTenantId, setNewUserTenantId] = useState('');
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const isSaasAdminUser = currentUser?.role === 'saas_admin';

  // Achado real em produção (12/08/2026): esse dropdown usava `tenants`
  // (prop vinda do App.tsx, só localStorage/mock — ex: id "tenant_004") em
  // vez da tabela real — cadastrar operador pra QUALQUER tenant (inclusive a
  // Monique) quebrava com "invalid input syntax for type uuid", porque o
  // backend exige um UUID de verdade. Busca separada, só pra este dropdown,
  // sem mexer no resto do painel (a aba "Tenants & Conexões" mistura campos
  // decorativos — plano, MRR, engine de WhatsApp — que não existem na tabela
  // `tenants` real; misturar os dois pediria um refactor maior, fora de
  // escopo aqui).
  const [realTenants, setRealTenants] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!isSaasAdminUser) return;
    apiFetch('/api/admin/tenants')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = (data?.tenants || []).map((t: any) => ({ id: t.id, name: t.name }));
        setRealTenants(list);
        setNewUserTenantId((prev) => prev || list[0]?.id || '');
      })
      .catch((err) => console.error('Falha ao carregar tenants reais:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSaasAdminUser]);

  const fetchOperators = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await apiFetch('/api/admin/operators');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const mapped: UserProfile[] = (data.operators || []).map((op: any) => ({
        id: op.id,
        tenantId: op.tenant_id,
        name: op.name,
        email: op.email,
        role: op.role,
        avatar: DEFAULT_USER_AVATAR,
        department: '',
      }));
      setUsersList(mapped);
    } catch (err) {
      console.error('Falha ao carregar operadores reais:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError(null);
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) return;
    if (isSaasAdminUser && !newUserTenantId) {
      setUserFormError('Nenhum tenant carregado ainda — aguarde a lista carregar antes de cadastrar.');
      return;
    }
    setIsSavingUser(true);
    try {
      const res = await apiFetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          password: newUserPassword,
          role: newUserRole,
          // Só saas_admin pode escolher o tenant — pra qualquer outro papel
          // o servidor ignora isso e usa sempre o tenant do próprio login.
          tenantId: isSaasAdminUser ? newUserTenantId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchOperators();
      setIsAddUserModalOpen(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
    } catch (err: any) {
      setUserFormError(err.message || 'Falha ao cadastrar o usuário.');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário ${userName}? Esse login para de funcionar imediatamente.`)) return;
    try {
      const res = await apiFetch(`/api/admin/operators/${userId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsersList((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      console.error('Falha ao excluir operador:', err);
      alert('Não foi possível excluir esse usuário agora. Tente de novo.');
    }
  };

  // Advanced Token Strategy & Telemetry state
  const [telemetryData, setTelemetryData] = useState<{
    summary: { totalSaaSTokens: number; totalSaaSCostUSD: number; totalCachedSaved: number; totalRequests: number };
    tenantsTelemetry: TenantTokenTelemetry[];
  } | null>(null);

  const [queueStatus, setQueueStatus] = useState<QueueSystemStatus | null>(null);
  const [isMockAiActive, setIsMockAiActive] = useState<boolean>(false);

  // New Tenant Form State
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState<TenantPlan>('pro');
  const [newPhone, setNewPhone] = useState('5511999887766');
  const [newEngine, setNewEngine] = useState<'evolution_vps' | 'zapi_managed' | 'meta_cloud_api'>('evolution_vps');
  const [customKey, setCustomKey] = useState('');
  const [metaPixel, setMetaPixel] = useState('');

  // Fetch live token telemetry and queue state
  const fetchTelemetry = async () => {
    try {
      const res = await apiFetch('/api/telemetry/tokens').catch(() => null);
      if (res && res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        if (isJson) {
          const data = await res.json();
          setTelemetryData(data);
          setIsMockAiActive(!!data.useMockAiMode);
        }
      }
      const qRes = await fetch('/api/queue/status').catch(() => null);
      if (qRes && qRes.ok) {
        const qIsJson = qRes.headers.get('content-type')?.includes('application/json');
        if (qIsJson) {
          const qData = await qRes.json();
          setQueueStatus(qData);
        }
      }
    } catch (err) {
      // Ignore transient network errors when polling
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleMockMode = async () => {
    try {
      const res = await apiFetch('/api/telemetry/toggle-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !isMockAiActive }),
      });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (res.ok && isJson) {
        const data = await res.json();
        setIsMockAiActive(data.useMockAiMode);
        fetchTelemetry();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.whatsappPhone.includes(searchTerm);
    const matchesPlan = planFilter === 'all' || t.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  // Calculate SaaS Global Metrics
  const totalMRR = tenants.reduce((acc, t) => acc + (t.status === 'ativo' ? t.monthlyMRR : 0), 0);
  const totalARR = totalMRR * 12;
  const activeTenantsCount = tenants.filter((t) => t.status === 'ativo').length;
  const totalProcessedLeads = tenants.reduce((acc, t) => acc + t.currentLeadsMonth, 0);


  // Calculate Infra Costs for Hybrid Engine
  const vpsCount = tenants.filter((t) => t.whatsappEngine === 'evolution_vps').length;
  const zapiCount = tenants.filter((t) => t.whatsappEngine === 'zapi_managed').length;
  const vpsCost = vpsCount > 0 ? 60 : 0; // Fixed VPS cost regardless of number of instances
  const zapiCost = zapiCount * 99; // R$ 99/month per instance
  const totalInfraCost = vpsCost + zapiCost;
  const netProfitMRR = totalMRR - totalInfraCost;
  const infraMarginPct = totalMRR > 0 ? (((totalMRR - totalInfraCost) / totalMRR) * 100).toFixed(1) : '100';

  const getPlanBadge = (plan: TenantPlan) => {
    switch (plan) {
      case 'enterprise':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
            Enterprise (R$ 2.900/mês)
          </span>
        );
      case 'pro':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
            Pro (R$ 1.200/mês)
          </span>
        );
      case 'starter':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
            Starter (R$ 590/mês)
          </span>
        );
    }
  };

  const getEngineBadge = (engine: 'evolution_vps' | 'zapi_managed' | 'meta_cloud_api') => {
    switch (engine) {
      case 'evolution_vps':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
            <Zap className="w-3 h-3 text-emerald-400" /> Evolution VPS (Docker R$0/num)
          </span>
        );
      case 'zapi_managed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-purple-400" /> Z-API Managed (R$99/mês)
          </span>
        );
      case 'meta_cloud_api':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-blue-400" /> Meta Cloud Direct
          </span>
        );
    }
  };

  const getStatusBadge = (status: TenantStatus) => {
    switch (status) {
      case 'ativo':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ativo
          </span>
        );
      case 'trial':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-400" /> Em Trial (14 dias)
          </span>
        );
      case 'suspenso':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-rose-400" /> Suspenso
          </span>
        );
      default:
        return null;
    }
  };

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const slug = newName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-');

    const mrrByPlan: Record<TenantPlan, number> = {
      starter: 590,
      pro: 1200,
      enterprise: 2900,
    };

    const newTenant: Tenant = {
      id: `tenant_${Date.now().toString().slice(-4)}`,
      name: newName.trim(),
      slug,
      plan: newPlan,
      monthlyMRR: mrrByPlan[newPlan],
      status: 'ativo',
      createdAt: new Date().toLocaleDateString('pt-BR'),
      whatsappPhone: newPhone.replace(/\D/g, '') || '5511999887766',
      whatsappStatus: 'conectado',
      whatsappEngine: newEngine,
      evolutionInstanceName: newEngine === 'evolution_vps' ? `${slug}_main` : undefined,
      zapiInstanceId: newEngine === 'zapi_managed' ? `${Date.now().toString().slice(-6)}-ZAPI` : undefined,
      zapiToken: newEngine === 'zapi_managed' ? `${Date.now().toString().slice(-8)}-TOKEN` : undefined,
      failoverEnabled: true,
      autoReconnectCount: 0,
      maxLeadsPerMonth: newPlan === 'enterprise' ? 20000 : newPlan === 'pro' ? 5000 : 1000,
      currentLeadsMonth: 0,
      // Deriva do domínio real em uso (produção ou preview), nunca hardcoded —
      // um domínio de dev fixo aqui faria o webhook de todo cliente novo
      // apontar pra um ambiente que não existe mais.
      webhookEndpoint: `${window.location.origin}/api/webhooks/whatsapp?tenantId=tenant_${Date.now().toString().slice(-4)}`,
      customGeminiKey: customKey ? '••••••••' : undefined,
      metaPixelId: metaPixel || undefined,
    };

    onAddTenant(newTenant);
    setIsNewTenantModalOpen(false);
    setNewName('');
  };

  const copyWebhook = (tenant: Tenant) => {
    navigator.clipboard.writeText(tenant.webhookEndpoint);
    setCopiedWebhookId(tenant.id);
    setTimeout(() => setCopiedWebhookId(null), 2500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* SaaS Admin Banner — achado real em produção: repetia "Painel SaaS
          Master" (a aba logo acima já diz isso) e "Empresa Selecionada no
          Painel" duplicava o nome do tenant que já aparece no topo da
          página (Header.tsx). Reduzido a só o que agrega: descrição curta
          do que esse painel controla + a ação real (onboarding). */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          Controle de empresas assinantes, receitas MRR/ARR, instâncias do WhatsApp e cotas de IA Gemini.
        </p>

        <button
          onClick={() => setIsNewTenantModalOpen(true)}
          className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition-all flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Onboarding Novo Cliente</span>
        </button>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveAdminTab('tenants')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all ${
            activeAdminTab === 'tenants'
              ? 'bg-emerald-600 text-slate-950 shadow-md shadow-emerald-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Tenants & Conexões</span>
        </button>

        <button
          onClick={() => setActiveAdminTab('users')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer ${
            activeAdminTab === 'users'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Gerenciador de Usuários ({usersList.length})</span>
        </button>

        <button
          onClick={() => setActiveAdminTab('roadmap')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer ${
            activeAdminTab === 'roadmap'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Roadmap Técnico & Backlog</span>
        </button>

        <button
          onClick={() => setActiveAdminTab('tokens_telemetry')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer ${
            activeAdminTab === 'tokens_telemetry'
              ? 'bg-amber-600 text-slate-950 shadow-md shadow-amber-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Telemetria de Tokens IA</span>
        </button>
      </div>

      {/* TAB CONTENT: TENANTS OVERVIEW */}
      {activeAdminTab === 'tenants' && (
        <div className="space-y-6">


      {/* Global SaaS KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>MRR (Receita Mensal Recorrente)</span>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400">
            R$ {totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-emerald-300 mt-2 font-medium">ARR Estimado: R$ {totalARR.toLocaleString('pt-BR')}/ano</p>
          <span
            className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700/60"
            title="MRR por tenant é um valor fixo escolhido ao criar o cliente (por plano), não calculado a partir de pagamento real recebido."
          >
            <FlaskConical className="w-2.5 h-2.5" />
            Dados de Exemplo
          </span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Clientes Ativos (Tenants)</span>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">{activeTenantsCount} Empresas</div>
          <p className="text-[10px] text-slate-500 mt-2">Churn Rate: &lt; 0.8% ao mês</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Leads & Áudios Processados</span>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">{totalProcessedLeads.toLocaleString('pt-BR')}</div>
          <p className="text-[10px] text-slate-500 mt-2">Via Gemini 3.6 Flash Server-Side</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Servidor e Conectores</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400">99.9% Uptime</div>
          <p className="text-[10px] text-emerald-300 mt-2 font-medium">Webhook Multi-Tenant Ativo</p>
        </div>
      </div>

      {/* Charts Section: SaaS Growth & Plan Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Crescimento de MRR do SaaS (R$)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Evolução do faturamento recorrente mensal da sua plataforma</p>
            </div>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MRR_HISTORY_DATA}>
                <defs>
                  <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `R$${v / 1000}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`R$ ${Number(val).toLocaleString('pt-BR')}`, 'MRR']}
                />
                <Area type="monotone" dataKey="mrr" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#mrrGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-emerald-400" />
              Distribuição por Planos de Assinatura
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Composição da receita de assinantes</p>
          </div>

          <div className="h-48 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={PLAN_DISTRIBUTION}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {PLAN_DISTRIBUTION.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`R$ ${Number(val).toLocaleString('pt-BR')}`, 'Total']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 text-xs">
            {PLAN_DISTRIBUTION.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-slate-300">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate max-w-[150px]">{item.name}</span>
                </div>
                <span className="font-bold text-white">R$ {item.value.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hybrid Architecture Strategy & Infrastructure Cost Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" />
              Estratégia Híbrida de Conectividade & Custos de Infraestrutura
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Optimização de margens: combinação de Servidor VPS Próprio (Evolution Docker) com Provedores Gerenciados (Z-API).
            </p>
          </div>

          <div className="flex items-center space-x-2 bg-emerald-950/80 border border-emerald-800/80 px-3.5 py-1.5 rounded-xl">
            <span className="text-xs text-emerald-300 font-medium">Margem Bruta de Infraestrutura:</span>
            <span className="text-sm font-black text-emerald-400">{infraMarginPct}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <Zap className="w-4 h-4" /> Opção A: VPS Docker (Evolution)
              </span>
              <span className="text-[10px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-800">
                {vpsCount} Tenants
              </span>
            </div>
            <div className="text-lg font-bold text-white">R$ {vpsCost.toFixed(2)}/mês total</div>
            <p className="text-[10px] text-slate-500">
              Custo fixo do servidor VPS. Permite conectar dezenas de números de clientes sem pagar custo por número.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold text-purple-400">
                <ShieldCheck className="w-4 h-4" /> Opção B: Z-API Gerenciada
              </span>
              <span className="text-[10px] bg-purple-950 text-purple-300 px-2 py-0.5 rounded-full border border-purple-800">
                {zapiCount} Tenants Enterprise
              </span>
            </div>
            <div className="text-lg font-bold text-white">R$ {zapiCost.toFixed(2)}/mês ({zapiCount}x R$99)</div>
            <p className="text-[10px] text-slate-500">
              Provedor terceirizado gerenciado de alta prioridade. Custo por número repassado ou embutido no plano Enterprise.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold text-blue-400">
                <DollarSign className="w-4 h-4" /> Resultado Líquido SaaS
              </span>
              <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800">
                Lucro Operacional
              </span>
            </div>
            <div className="text-lg font-black text-emerald-400">
              R$ {netProfitMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
            </div>
            <p className="text-[10px] text-slate-500">
              MRR Bruto (R$ {totalMRR.toLocaleString('pt-BR')}) - Custo Infra (R$ {totalInfraCost.toFixed(2)})
            </p>
          </div>
        </div>
      </div>

      {/* Tenants Management Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Lista de Clientes SaaS (Tenants Cadastrados)</h2>
            <p className="text-xs text-slate-400">Alterne o contexto de atendimento para gerenciar e dar suporte a qualquer empresa</p>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar empresa ou telefone..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-8"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            </div>

            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Todos os Planos</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
<div className="mb-4 flex justify-end">
  <ConectarEvolutionQrCode />
</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
              <tr>
                <th className="p-3.5">Empresa / Tenant</th>
                <th className="p-3.5">Plano & MRR</th>
                <th className="p-3.5">Motor de Conexão Engine</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">WhatsApp / Conexão</th>
                <th className="p-3.5">Uso de Leads (Mês)</th>
                <th className="p-3.5">URL Webhook Exclusivo</th>
                <th className="p-3.5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredTenants.map((t) => {
                const isActiveTenant = t.id === activeTenant.id;
                const leadsPct = Math.round((t.currentLeadsMonth / t.maxLeadsPerMonth) * 100);

                return (
                  <tr
                    key={t.id}
                    className={`transition-colors ${
                      isActiveTenant ? 'bg-emerald-950/30' : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="p-3.5">
                      <div className="font-bold text-white text-sm flex items-center gap-1.5">
                        {t.name}
                        {isActiveTenant && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
                            Atual no Painel
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">ID: {t.id} ({t.slug})</div>
                    </td>

                    <td className="p-3.5">
                      {getPlanBadge(t.plan)}
                      <div className="text-xs font-bold text-white mt-1">
                        R$ {t.monthlyMRR.toLocaleString('pt-BR')}/mês
                      </div>
                    </td>

                    <td className="p-3.5">
                      {getEngineBadge(t.whatsappEngine || 'evolution_vps')}
                    </td>

                    <td className="p-3.5">{getStatusBadge(t.status)}</td>

                    <td className="p-3.5">
                      <div className="text-slate-200 font-medium">{t.whatsappPhone}</div>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" /> WhatsApp Conectado
                      </span>
                    </td>

                    <td className="p-3.5 min-w-[140px]">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span>{t.currentLeadsMonth} / {t.maxLeadsPerMonth}</span>
                        <span>{leadsPct}%</span>
                      </div>
                      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(leadsPct, 100)}%` }}
                        />
                      </div>
                    </td>

                    <td className="p-3.5 max-w-xs">
                      <div className="flex items-center justify-between bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-400">
                        <span className="truncate mr-2">{t.webhookEndpoint}</span>
                        <button
                          type="button"
                          onClick={() => copyWebhook(t)}
                          className="text-emerald-400 hover:text-emerald-300"
                          title="Copiar URL Webhook"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {copiedWebhookId === t.id && (
                        <span className="text-[9px] text-emerald-400 block mt-0.5">Copiado!</span>
                      )}
                    </td>

                    <td className="p-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectTenant(t)}
                        disabled={isActiveTenant}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center space-x-1 ml-auto ${
                          isActiveTenant
                            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow'
                        }`}
                      >
                        <span>{isActiveTenant ? 'Ativo' : 'Acessar Painel'}</span>
                        {!isActiveTenant && <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}

      {/* TAB CONTENT: ESTRATÉGIA DE TOKENS & ARQUITETURA SAAS */}
      {activeAdminTab === 'tokens_telemetry' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Bar with Mocking Toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <Cpu className="w-5 h-5 text-purple-400" />
                <h2 className="text-base font-bold text-white">Arquitetura Avançada & Gestão de Tokens Gemini</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-300 border border-purple-800">
                  Pay-as-You-Go + Context Cache
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Controle de custos por tenant, resiliência com filas, cache local de desenvolvimento e simulação da Gemini Batch API.
              </p>
            </div>

            {/* Development Mock Mode Switch */}
            <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl flex items-center space-x-4">
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-emerald-400" />
                  Modo Mock Local (`USE_MOCK_AI`)
                </div>
                <div className="text-[10px] text-slate-400">
                  {isMockAiActive
                    ? 'ATIVADO: Respostas simuladas sem gastar cota/tokens durante edições de layout'
                    : 'DESATIVADO: Chamadas reais conectadas ao Google Gemini API'}
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleMockMode}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all ${
                  isMockAiActive
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-950/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                }`}
              >
                {isMockAiActive ? <ToggleRight className="w-5 h-5 text-slate-950" /> : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                <span>{isMockAiActive ? 'Mocking Ativado' : 'Ativar Mocking'}</span>
              </button>
            </div>
          </div>

          {/* Strategy Overview KPIs — achado numa auditoria: enquanto telemetryData
              ainda não chegava (ou se /api/telemetry/tokens falhasse em silêncio,
              já que fetchTelemetry engole erros), estes cards mostravam números
              fixos no código (18970 tokens, $0.0023, 184 jobs) com a mesma
              confiança visual de um dado real, sem nenhuma indicação de que era
              placeholder. Mostra "—" em vez de inventar consumo/custo de Gemini. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Total Tokens Consumidos</span>
                <Cpu className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-black text-white">
                {telemetryData ? telemetryData.summary.totalSaaSTokens.toLocaleString('pt-BR') : '—'}
              </div>
              <p className="text-[10px] text-purple-300">Medido via objeto `usageMetadata` do Gemini</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Custo Estimado Gemini API</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-emerald-400">
                {telemetryData ? `$${telemetryData.summary.totalSaaSCostUSD.toFixed(5)} USD` : '—'}
              </div>
              <p className="text-[10px] text-emerald-300 font-medium">~$0.075 / 1M input • ~$0.30 / 1M output</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Tokens Economizados (Cache)</span>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-amber-400">
                {telemetryData ? telemetryData.summary.totalCachedSaved.toLocaleString('pt-BR') : '—'}
              </div>
              <p className="text-[10px] text-amber-300 font-medium">Até 75% de desconto via Context Caching</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Fila & Rate Limiter (BullMQ)</span>
                <Activity className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-black text-blue-400">
                {queueStatus ? `${queueStatus.completedJobs} Jobs Concluídos` : '—'}
              </div>
              <p className="text-[10px] text-slate-400">
                {queueStatus?.backoffActive ? '⚠️ Backoff Exponencial 429 Ativo' : 'Rate Limit: 60 RPM • Retentativa Exponencial'}
              </p>
            </div>
          </div>

          {/* TELEMETRIA DE TOKENS POR TENANT */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-purple-400" />
                  Telemetria de Consumo de Tokens por Tenant (Cliente)
                </h3>
                <p className="text-xs text-slate-400">
                  Medição individualizada por `tenant_id` para faturamento por uso (Usage-based billing)
                </p>
              </div>

              <button
                type="button"
                onClick={fetchTelemetry}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Atualizar Telemetria</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="p-3">Empresa / Tenant ID</th>
                    <th className="p-3">Prompt Tokens (Input)</th>
                    <th className="p-3">Candidate Tokens (Output)</th>
                    <th className="p-3">Total Tokens</th>
                    <th className="p-3">Tokens Salvos (Cache)</th>
                    <th className="p-3">Custo Estimado (USD)</th>
                    <th className="p-3">Requisições</th>
                    <th className="p-3">Última Atividade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {/* Achado numa auditoria: sem telemetria real ainda, esta tabela
                      mostrava duas empresas inventadas ("Clínica Sorriso Dourado",
                      "Advocacia Silva & Associados") com tokens/custos fixos no
                      código — dado de negócio fabricado, com a mesma cara de uma
                      medição real. Mostra um estado vazio honesto em vez disso. */}
                  {telemetryData && telemetryData.tenantsTelemetry.length > 0 ? (
                    telemetryData.tenantsTelemetry.map((tRecord) => (
                      <tr key={tRecord.tenantId} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">
                          {tRecord.tenantName}
                          <div className="text-[10px] text-slate-500 font-mono">{tRecord.tenantId}</div>
                        </td>
                        <td className="p-3 font-mono text-slate-300">{tRecord.promptTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono text-purple-300">{tRecord.candidatesTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono font-bold text-emerald-400">{tRecord.totalTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono text-amber-400">{tRecord.cachedTokensSaved.toLocaleString()}</td>
                        <td className="p-3 font-mono font-bold text-emerald-300">${tRecord.estimatedCostUSD.toFixed(5)}</td>
                        <td className="p-3 font-mono text-slate-400">{tRecord.requestCount} reqs</td>
                        <td className="p-3 text-[10px] text-slate-500 font-mono">
                          {new Date(tRecord.lastRequestAt).toLocaleTimeString('pt-BR')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-xs text-slate-500">
                        {telemetryData ? 'Nenhum tenant com consumo de tokens registrado ainda.' : 'Carregando telemetria...'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* VERTEX AI MIGRATION PANEL */}
          <div className="grid grid-cols-1 gap-6">
            {/* Google Cloud Vertex AI & Billing Guide */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-purple-400" />
                    Guia de Migração: Google Cloud Vertex AI
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Passos recomendados para escala comercial enterprise e cota reservada.
                  </p>
                </div>
                <span className="px-2 py-0.5 text-[10px] bg-purple-950 text-purple-300 border border-purple-800 font-bold rounded-md">
                  Pronto p/ Produção
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2 text-xs text-slate-300">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  1. Ativação de Faturamento (Pay-as-You-Go)
                </div>
                <p className="text-slate-400">
                  Ao vincular uma conta do Google Cloud, a cota salta do plano gratuito restrito para milhares de RPM.
                </p>

                <div className="font-bold text-white flex items-center gap-1.5 pt-2 border-t border-slate-800">
                  <CheckCircle2 className="w-4 h-4 text-purple-400" />
                  2. Migração para Vertex AI (`us-central1`)
                </div>
                <p className="text-slate-400">
                  O sistema possui suporte nativo para chave Vertex AI e autenticação via Service Account JSON.
                </p>

                <div className="font-bold text-white flex items-center gap-1.5 pt-2 border-t border-slate-800">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  3. Provisioned Throughput (Garantia de Capacidade)
                </div>
                <p className="text-slate-400">
                  Garante capacidade reservada e SLA contratual durante picos de disparos de anúncios.
                </p>

                <a
                  href="https://console.cloud.google.com/iam-admin/quotas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center space-x-1.5 text-xs text-purple-400 hover:text-purple-300 font-bold"
                >
                  <span>Acessar Console do Google Cloud Quotas</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: ROADMAP TÉCNICO */}
      {activeAdminTab === 'roadmap' && (
        <div className="space-y-6 animate-fade-in">
          {/* BACKLOG TÉCNICO & ROADMAP DE IMPLEMENTAÇÕES NÃO URGENTES */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  Lista de Pendências & Roadmap Técnico (Implementações Não-Urgentes)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Melhorias planejadas para escalabilidade, automação de instâncias WhatsApp e relatórios avançados.
                </p>
              </div>
              <span className="text-xs bg-purple-950 text-purple-300 border border-purple-800 px-3 py-1 rounded-xl font-semibold">
                5 Módulos Planejados
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <Zap className="w-4 h-4" /> 1. Automação Zero-Touch de Instâncias WhatsApp
                  </span>
                  <span className="text-[10px] bg-amber-950 text-amber-400 px-2 py-0.5 rounded-md font-semibold border border-amber-800">
                    Média Prioridade
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Criar e configurar instâncias na Z-API ou Evolution API via requisição HTTP direta no momento em que o cliente se cadastra, gerando o QR Code automaticamente no painel sem intervenção manual.
                </p>
                <div className="text-[10px] text-slate-500 font-mono">
                  APIs: POST /instance/create • POST /webhook/set
                </div>
              </div>

              {/* Card 2 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> 2. Circuit Breaker & Failover Automático
                  </span>
                  <span className="text-[10px] bg-amber-950 text-amber-400 px-2 py-0.5 rounded-md font-semibold border border-amber-800">
                    Média Prioridade
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Caso a VPS da Evolution API sofra downtime ou perca a conexão socket com os servidores do WhatsApp, o sistema redireciona automaticamente o fluxo de envios para a Z-API secundária sem perder mensagens dos leads.
                </p>
                <div className="text-[10px] text-slate-500 font-mono">
                  Monitoria: Heatbeat Ping a cada 30 segundos
                </div>
              </div>

              {/* Card 3 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                    <PieChartIcon className="w-4 h-4" /> 3. Exportador de Relatórios Financeiros & Churn
                  </span>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-semibold border border-slate-700">
                    Baixa Prioridade
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Gerador de relatórios executivos em PDF/CSV contendo histórico de pagamentos, retenção por plano, custo de infraestrutura por empresa e margem operacional líquida do SaaS.
                </p>
                <div className="text-[10px] text-slate-500 font-mono">
                  Formatos: CSV, PDF, JSON Export
                </div>
              </div>

              {/* Card 4 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Key className="w-4 h-4" /> 4. Gestão Granular de Permissões de Usuários (RBAC)
                  </span>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-semibold border border-slate-700">
                    Baixa Prioridade
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Criação de papéis customizados dentro do CRM de cada tenant (ex: Vendedor Júnior só visualiza seus próprios leads; Gerente de Vendas acessa métricas da equipe; Finanças acessa relatórios).
                </p>
                <div className="text-[10px] text-slate-500 font-mono">
                  Níveis: Master Admin, Tenant Owner, Supervisor, Operador CRM
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: GERENCIADOR DE USUÁRIOS E OPERADORES */}
      {activeAdminTab === 'users' && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Actions & KPI Row */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  Gerenciador de Usuários e Operadores do Sistema
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cadastre novos usuários, altere permissões de acesso e gerencie os operadores por empresa (Tenant)
                </p>
              </div>

              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-950/40 flex items-center space-x-2 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Novo Usuário / Operador</span>
              </button>
            </div>

            {/* User Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Buscar por nome, e-mail..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-xs text-slate-400">Filtrar Função:</span>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="all">Todas as Funções</option>
                  <option value="saas_admin">SaaS Master Admin</option>
                  <option value="admin">Administrador</option>
                  <option value="manager">Gerente</option>
                  <option value="operator">Operador</option>
                </select>
              </div>
            </div>

            {/* Users Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-3 rounded-l-xl">Usuário / Operador</th>
                    <th className="p-3">E-mail de Acesso</th>
                    <th className="p-3">Função & Permissão</th>
                    <th className="p-3">Empresa (Tenant)</th>
                    <th className="p-3 text-right rounded-r-xl">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {isLoadingUsers ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">Carregando usuários...</td>
                    </tr>
                  ) : usersList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">Nenhum usuário cadastrado ainda.</td>
                    </tr>
                  ) : (
                    usersList
                      .filter((u) => {
                        const matchesSearch =
                          u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                          u.email.toLowerCase().includes(userSearch.toLowerCase());
                        const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
                        return matchesSearch && matchesRole;
                      })
                      .map((usr) => {
                        const tenantObj = tenants.find((t) => t.id === usr.tenantId);
                        return (
                          <tr key={usr.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 font-semibold text-white flex items-center space-x-3">
                              <img
                                src={usr.avatar || DEFAULT_USER_AVATAR}
                                alt={usr.name}
                                className="w-8 h-8 rounded-full object-cover border border-slate-700"
                              />
                              <span>{usr.name}</span>
                            </td>
                            <td className="p-3 text-slate-300 font-mono text-[11px]">{usr.email}</td>
                            <td className="p-3">
                              {usr.role === 'saas_admin' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                                  SaaS Master Admin
                                </span>
                              )}
                              {usr.role === 'admin' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800/80">
                                  Administrador
                                </span>
                              )}
                              {usr.role === 'manager' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800/80">
                                  Gerente
                                </span>
                              )}
                              {usr.role === 'operator' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/80">
                                  Operador
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className="text-slate-300 font-medium">
                                {tenantObj ? tenantObj.name : usr.tenantId}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleDeleteUser(usr.id, usr.name)}
                                className="p-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg transition-colors cursor-pointer"
                                title="Excluir Usuário"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* NEW USER MODAL */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-5">
            <button
              onClick={() => setIsAddUserModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
              <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Cadastrar Novo Usuário / Operador</h2>
                <p className="text-xs text-slate-400">Preencha os dados e defina o nível de acesso à plataforma</p>
              </div>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Ex: Ana Maria Souza"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail de Acesso (Login)</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="ana@suaempresa.com.br"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Senha de Acesso Inicial</label>
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                    Login real — a pessoa já consegue entrar com esse e-mail e senha assim que salvar.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Função / Nível de Acesso</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value="operator">Operador</option>
                    <option value="manager">Gerente</option>
                    <option value="admin">Administrador</option>
                    {isSaasAdminUser && <option value="saas_admin">SaaS Master Admin</option>}
                  </select>
                </div>
              </div>

              {isSaasAdminUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Empresa (Tenant)</label>
                  <select
                    value={newUserTenantId}
                    onChange={(e) => setNewUserTenantId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    {realTenants.length === 0 && <option value="">Carregando tenants...</option>}
                    {realTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {userFormError && (
                <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{userFormError}</p>
              )}

              <button
                type="submit"
                disabled={isSavingUser}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer mt-4"
              >
                <Users className="w-4 h-4" />
                <span>{isSavingUser ? 'Salvando...' : 'Salvar e Cadastrar Usuário'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* NEW TENANT ONBOARDING MODAL */}

      {isNewTenantModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-5">
            <button
              onClick={() => setIsNewTenantModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Cadastrar Novo Cliente SaaS (Tenant)</h2>
                <p className="text-xs text-slate-400">Onboarding instantâneo de uma nova empresa assinante</p>
              </div>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nome da Empresa / Cliente</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Clínica Odontológica Sorriso Perfeito"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Plano Escolhido</label>
                  <select
                    value={newPlan}
                    onChange={(e) => setNewPlan(e.target.value as TenantPlan)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="starter">Starter (R$ 590/mês)</option>
                    <option value="pro">Pro (R$ 1.200/mês)</option>
                    <option value="enterprise">Enterprise (R$ 2.900/mês)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Número do WhatsApp (API)</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="5511999887766"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Motor de Conexão (Estratégia Híbrida)</label>
                <select
                  value={newEngine}
                  onChange={(e) => setNewEngine(e.target.value as 'evolution_vps' | 'zapi_managed' | 'meta_cloud_api')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="evolution_vps">Opção A: Evolution API VPS Docker (Custo R$ 0/num - Alta Margem)</option>
                  <option value="zapi_managed">Opção B: Z-API Gerenciada (Custo R$ 99/mês - 99.9% Uptime Terceirizado)</option>
                  <option value="meta_cloud_api">Meta Cloud API Direct (WhatsApp Business API)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Chave de API Gemini Própria (Opcional - usa a global do SaaS se vazia)
                </label>
                <input
                  type="password"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Pixel ID da Meta / Facebook (Meta CAPI)</label>
                <input
                  type="text"
                  value={metaPixel}
                  onChange={(e) => setMetaPixel(e.target.value)}
                  placeholder="Ex: 987654321012345"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
              >
                <Building2 className="w-4 h-4" />
                <span>Ativar Empresa & Gerar Webhook</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
