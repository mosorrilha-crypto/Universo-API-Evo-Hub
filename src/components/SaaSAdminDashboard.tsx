import React, { useState, useEffect } from 'react';
import { Tenant, UserProfile, UserRole, TenantTokenTelemetry, QueueSystemStatus } from '../types';
import { apiFetch } from '../lib/apiClient';
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
  RefreshCw,
  Server,
  Activity,
  FlaskConical,
  Brain,
  Save,
  RotateCcw,
  Loader2
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
/**
 * Credenciais Meta Conversions API (CAPI) por tenant — achado numa
 * auditoria (13/08/2026): o backend já dispara sozinho os eventos
 * "Schedule"/"Purchase" quando o agente confirma um agendamento/pagamento
 * real (server/services/metaCapiService.ts, fireMetaCapiEventForTenant),
 * mas as credenciais que esse disparo automático lê
 * (tenant_meta_credentials.capi_dataset_id/capi_access_token/capi_page_id)
 * nunca tinham nenhuma tela que as gravasse — o operador ficava sempre
 * dependendo do botão manual da aba "Central & Disparo Meta CAPI", mesmo
 * pra lead vindo de anúncio Clique-para-WhatsApp. Mesmo padrão de
 * `ConectarEvolutionQrCode` acima: busca a lista REAL de tenants (GET
 * /api/admin/tenants), não a tabela local/mock desta tela.
 */
function GerenciarCredenciaisCapi() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [realTenants, setRealTenants] = useState<RealTenant[]>([]);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [datasetId, setDatasetId] = useState('');
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accessTokenSet, setAccessTokenSet] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  // Nunca limpa successMsg aqui — handleSave chama isso logo depois de setar
  // a mensagem de sucesso pra atualizar os campos com o que ficou salvo, e
  // um setSuccessMsg(null) aqui apagaria o banner antes do operador
  // conseguir ver (achado num smoke test manual: o banner nunca aparecia).
  const fetchCredentials = async (tenantId: string) => {
    if (!tenantId) return;
    setIsLoadingCreds(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/capi-credentials`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDatasetId(data.capiDatasetId || '');
      setPageId(data.capiPageId || '');
      setAccessTokenSet(!!data.capiAccessTokenSet);
      setAccessToken('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao carregar credenciais.');
    } finally {
      setIsLoadingCreds(false);
    }
  };

  const openModal = () => {
    setIsModalOpen(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    fetchRealTenants();
  };

  useEffect(() => {
    if (isModalOpen && selectedTenantId) fetchCredentials(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, selectedTenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId) return;
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/capi-credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capiDatasetId: datasetId.trim() || null,
          capiPageId: pageId.trim() || null,
          // Em branco = manter o token já salvo (nunca volta em texto puro
          // do GET, então "em branco" é a única forma de expressar "não mexi
          // nisso" sem o admin precisar re-digitar um segredo que já sabe
          // que está configurado).
          ...(accessToken.trim() ? { capiAccessToken: accessToken.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuccessMsg('Credenciais salvas! Agendamento/pagamento confirmado por leads vindos de anúncio agora disparam CAPI automaticamente.');
      await fetchCredentials(selectedTenantId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao salvar credenciais.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 transition-all shadow"
      >
        <Zap className="w-3.5 h-3.5" />
        Credenciais Meta CAPI
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsModalOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400" /> Credenciais Meta CAPI (disparo automático)
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Com isso configurado, o Universo dispara "Schedule"/"Purchase" pro Meta Conversions API sozinho quando o agente
              confirma um agendamento ou pagamento de um lead que veio de anúncio Clique-para-WhatsApp — sem depender de clique
              manual na aba "Central &amp; Disparo Meta CAPI".
            </p>

            {errorMsg && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{errorMsg}</div>
            )}
            {successMsg && (
              <div className="bg-emerald-950/60 border border-emerald-800 rounded-lg p-2.5 text-xs text-emerald-300">{successMsg}</div>
            )}

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Tenant</label>
              <select
                value={selectedTenantId}
                onChange={(e) => {
                  setSuccessMsg(null);
                  setSelectedTenantId(e.target.value);
                }}
                disabled={isLoadingTenants || !realTenants.length}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {!realTenants.length && <option value="">{isLoadingTenants ? 'Carregando...' : 'Nenhum tenant cadastrado ainda'}</option>}
                {realTenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Dataset ID (Conjunto de Dados)</label>
                <input
                  type="text"
                  value={datasetId}
                  onChange={(e) => setDatasetId(e.target.value)}
                  disabled={isLoadingCreds}
                  placeholder="Ex: 891029384712039"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Page ID (Facebook)</label>
                <input
                  type="text"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  disabled={isLoadingCreds}
                  placeholder="Ex: 102345678901234"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1.5">
                  <Key className="w-3 h-3" /> System User Access Token
                </label>
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  disabled={isLoadingCreds}
                  placeholder={accessTokenSet ? 'Já configurado — deixe em branco pra manter' : 'Cole o token aqui'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={!selectedTenantId || isSaving || isLoadingCreds}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {isSaving ? 'Salvando...' : 'Salvar credenciais'}
              </button>
            </form>
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

export const SaaSAdminDashboard: React.FC<SaaSAdminDashboardProps> = ({
  currentUser,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<string>('all');
  const [activeAdminTab, setActiveAdminTab] = useState<'tenants' | 'users' | 'tokens_telemetry' | 'roadmap' | 'global_prompt'>('tenants');

  // Camada 1 (Global) do prompt do agente — editável por saas_admin sem
  // PR+deploy (ver server/services/globalPromptStore.ts). content null =
  // nenhum override salvo, o texto padrão do código está em vigor.
  const [globalPromptContent, setGlobalPromptContent] = useState<string | null>(null);
  const [globalPromptDefault, setGlobalPromptDefault] = useState('');
  const [globalPromptDraft, setGlobalPromptDraft] = useState('');
  const [globalPromptUpdatedAt, setGlobalPromptUpdatedAt] = useState<string | null>(null);
  const [globalPromptLoaded, setGlobalPromptLoaded] = useState(false);
  const [isLoadingGlobalPrompt, setIsLoadingGlobalPrompt] = useState(false);
  const [isSavingGlobalPrompt, setIsSavingGlobalPrompt] = useState(false);
  const [globalPromptError, setGlobalPromptError] = useState<string | null>(null);

  const handleLoadGlobalPrompt = async () => {
    setIsLoadingGlobalPrompt(true);
    setGlobalPromptError(null);
    try {
      const res = await apiFetch('/api/admin/global-prompt');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGlobalPromptContent(data.content ?? null);
      setGlobalPromptDefault(data.defaultContent || '');
      // Sem override salvo: pré-preenche com o texto padrão real (não deixa
      // a caixa vazia) — achado real de UX, o saas_admin precisa ver o que
      // está em vigor pra poder editar a partir dali, não só uma dica de texto.
      setGlobalPromptDraft(data.content || data.defaultContent || '');
      setGlobalPromptUpdatedAt(data.updatedAt || null);
      setGlobalPromptLoaded(true);
    } catch (err: any) {
      setGlobalPromptError(err.message || 'Falha ao carregar o prompt global.');
    } finally {
      setIsLoadingGlobalPrompt(false);
    }
  };

  useEffect(() => {
    if (activeAdminTab === 'global_prompt' && !globalPromptLoaded && !isLoadingGlobalPrompt) {
      handleLoadGlobalPrompt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminTab]);

  const handleSaveGlobalPrompt = async () => {
    setIsSavingGlobalPrompt(true);
    setGlobalPromptError(null);
    try {
      // Salvar o texto padrão sem nenhuma edição real é equivalente a não
      // ter override nenhum — evita criar uma linha "customizada" idêntica
      // ao padrão só porque o admin clicou Salvar sem mudar nada.
      const contentToSave = globalPromptDraft.trim() === globalPromptDefault.trim() ? null : globalPromptDraft.trim() || null;
      const res = await apiFetch('/api/admin/global-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentToSave }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGlobalPromptContent(data.content ?? null);
      setGlobalPromptDraft(data.content || globalPromptDefault);
      setGlobalPromptUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setGlobalPromptError(err.message || 'Falha ao salvar o prompt global.');
    } finally {
      setIsSavingGlobalPrompt(false);
    }
  };

  const handleResetGlobalPrompt = async () => {
    if (!window.confirm('Restaurar o texto padrão do código? Isso apaga o override salvo — o agente volta a usar a regra fixa original em todos os tenants.')) return;
    setIsSavingGlobalPrompt(true);
    setGlobalPromptError(null);
    try {
      const res = await apiFetch('/api/admin/global-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGlobalPromptContent(null);
      setGlobalPromptDraft(globalPromptDefault);
      setGlobalPromptUpdatedAt(new Date().toISOString());
    } catch (err: any) {
      setGlobalPromptError(err.message || 'Falha ao restaurar o padrão.');
    } finally {
      setIsSavingGlobalPrompt(false);
    }
  };
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

  // Lista real de tenants (GET /api/admin/tenants, tabela `tenants` do
  // Supabase) — achado real em produção (12/08/2026): o dropdown de
  // cadastro de usuário usava a prop `tenants` (vinda do App.tsx, só
  // localStorage/mock — ex: id "tenant_004") em vez da tabela real —
  // cadastrar operador pra QUALQUER tenant (inclusive a Monique) quebrava
  // com "invalid input syntax for type uuid", porque o backend exige um
  // UUID de verdade. Achado numa auditoria seguinte (13/08/2026): a aba
  // "Tenants & Conexões" inteira (cards de MRR/ARR, gráfico de crescimento,
  // distribuição de planos, calculadora de margem de infraestrutura,
  // tabela de clientes) rodava sobre `tenants` (a mesma prop mock) também —
  // mostrava sempre "1 Empresa" (a Monique fictícia, tenant_004) mesmo com
  // outros tenants reais já cadastrados no banco. Uma lista só, real, usada
  // em todo o painel agora — sem os campos decorativos (plano, MRR, engine
  // de WhatsApp) que nunca existiram na tabela `tenants` real.
  const [realTenants, setRealTenants] = useState<
    { id: string; name: string; slug: string | null; segment: string | null; currency: string; locale: string; createdAt: string; whatsappConnected: boolean }[]
  >([]);
  const [isLoadingRealTenants, setIsLoadingRealTenants] = useState(false);

  const fetchRealTenants = async () => {
    if (!isSaasAdminUser) return;
    setIsLoadingRealTenants(true);
    try {
      const res = await apiFetch('/api/admin/tenants');
      const data = res.ok ? await res.json() : null;
      const list = (data?.tenants || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        slug: t.slug ?? null,
        segment: t.segment ?? null,
        currency: t.currency,
        locale: t.locale,
        createdAt: t.created_at,
        whatsappConnected: !!t.whatsappConnected,
      }));
      setRealTenants(list);
      setNewUserTenantId((prev) => prev || list[0]?.id || '');
    } catch (err) {
      console.error('Falha ao carregar tenants reais:', err);
    } finally {
      setIsLoadingRealTenants(false);
    }
  };

  useEffect(() => {
    fetchRealTenants();
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

  // Troca de função direto no painel — antes só dava pra corrigir via SQL
  // direto no banco (achado real: um operador cadastrado como "Operador"
  // não enxergava a aba Base de Conhecimento, que exige "Administrador" ou
  // acima, e não tinha como consertar isso sozinho no painel).
  const [savingRoleForUserId, setSavingRoleForUserId] = useState<string | null>(null);
  const handleUpdateUserRole = async (userId: string, newRole: UserRole) => {
    const previous = usersList;
    setSavingRoleForUserId(userId);
    setUsersList((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    try {
      const res = await apiFetch(`/api/admin/operators/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error('Falha ao atualizar função do operador:', err);
      setUsersList(previous);
      alert(`Não foi possível atualizar a função: ${err?.message || 'tente de novo.'}`);
    } finally {
      setSavingRoleForUserId(null);
    }
  };

  // Advanced Token Strategy & Telemetry state
  const [telemetryData, setTelemetryData] = useState<{
    summary: { totalSaaSTokens: number; totalSaaSCostUSD: number; totalCachedSaved: number; totalRequests: number };
    tenantsTelemetry: TenantTokenTelemetry[];
  } | null>(null);

  const [queueStatus, setQueueStatus] = useState<QueueSystemStatus | null>(null);

  // Fetch live token telemetry and queue state
  const fetchTelemetry = async () => {
    try {
      const res = await apiFetch('/api/telemetry/tokens').catch(() => null);
      if (res && res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        if (isJson) {
          const data = await res.json();
          setTelemetryData(data);
        }
      }
      // Achado real em produção (13/08/2026): usava `fetch` puro em vez de
      // `apiFetch` — sem o header Authorization, `authenticateToken` nessa
      // rota sempre rejeitava com 401, repetindo no console a cada 10s (o
      // intervalo abaixo) enquanto o painel SaaS Master ficasse aberto,
      // mesmo em abas que não são a de Telemetria.
      const qRes = await apiFetch('/api/queue/status').catch(() => null);
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

  // Empresas reais (GET /api/admin/tenants) filtradas por busca + segmento —
  // `segment` é campo real da tabela `tenants` (docs/AGENTE-VERTICAL-
  // ARQUITETURA.md, Camada 2), diferente do "plano"/MRR/engine de WhatsApp
  // que nunca existiram de verdade no schema (ver comentário acima, na
  // definição de `realTenants`).
  const filteredRealTenants = realTenants.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.slug || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSegment = segmentFilter === 'all' || t.segment === segmentFilter;
    return matchesSearch && matchesSegment;
  });
  const whatsappConnectedCount = realTenants.filter((t) => t.whatsappConnected).length;
  const knownSegments = Array.from(new Set(realTenants.map((t) => t.segment).filter((s): s is string => !!s)));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* SaaS Admin Banner — achado real em produção: repetia "Painel SaaS
          Master" (a aba logo acima já diz isso) e "Empresa Selecionada no
          Painel" duplicava o nome do tenant que já aparece no topo da
          página (Header.tsx). Reduzido a só o que agrega: descrição curta
          do que esse painel controla. O botão "Onboarding Novo Cliente" que
          ficava aqui abria um modal 100% local — criava um tenant fictício
          só na memória do navegador (nunca gravava em `tenants` de verdade)
          e chegava a coletar uma chave de API Gemini real só pra descartá-la
          na hora (`customGeminiKey: customKey ? '••••••••' : undefined`).
          Removido — o onboarding real (cria o tenant em `tenants` via POST
          /api/admin/tenants e já provisiona WhatsApp) é o botão "Conectar
          WhatsApp via QR Code" logo abaixo, na tabela. */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          Controle de empresas cadastradas, conexões de WhatsApp e cotas de IA Gemini.
        </p>
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

        <button
          onClick={() => setActiveAdminTab('global_prompt')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer ${
            activeAdminTab === 'global_prompt'
              ? 'bg-pink-600 text-white shadow-md shadow-pink-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Brain className="w-4 h-4" />
          <span>Prompt Global do Agente</span>
        </button>
      </div>

      {/* TAB CONTENT: TENANTS OVERVIEW — achado numa auditoria (13/08/2026):
          esta aba inteira (4 cards de MRR/ARR/Leads/Uptime, gráfico de
          crescimento de MRR, donut de distribuição de planos, calculadora
          de margem de infraestrutura VPS x Z-API, e a própria tabela de
          clientes) rodava sobre a prop `tenants` — só um mock local
          (INITIAL_TENANTS, 1 tenant fictício, "Monique Sorrilha Beauty
          Studio") — nunca a lista real do Supabase. Mostrava sempre "1
          Empresa"/"99.9% Uptime"/margem calculada mesmo com outros tenants
          reais já cadastrados. Reescrito pra usar só `realTenants` (GET
          /api/admin/tenants, mesma fonte que os botões de conexão abaixo já
          usavam) — sem inventar MRR, plano, engine de WhatsApp ou uptime,
          nenhum dos quais existe de verdade na tabela `tenants`. */}
      {activeAdminTab === 'tenants' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Empresas Cadastradas</span>
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                  <Building2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-white">
                {isLoadingRealTenants ? '—' : realTenants.length}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Tabela `tenants` real (Supabase)</p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>WhatsApp Conectado</span>
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-emerald-400">
                {isLoadingRealTenants ? '—' : `${whatsappConnectedCount} / ${realTenants.length}`}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Via credencial Meta ou instância Evolution real</p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">Lista de Clientes SaaS (Tenants Cadastrados)</h2>
                <p className="text-xs text-slate-400">Empresas reais cadastradas no banco — cada linha corresponde a um tenant de verdade.</p>
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar empresa..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-8"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                </div>

                <select
                  value={segmentFilter}
                  onChange={(e) => setSegmentFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">Todos os Segmentos</option>
                  {knownSegments.map((seg) => (
                    <option key={seg} value={seg}>{seg}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <GerenciarCredenciaisCapi />
              <ConectarEvolutionQrCode />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="p-3.5">Empresa / Tenant</th>
                    <th className="p-3.5">Segmento</th>
                    <th className="p-3.5">Moeda / Idioma</th>
                    <th className="p-3.5">WhatsApp</th>
                    <th className="p-3.5">Criado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {isLoadingRealTenants ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">Carregando tenants...</td>
                    </tr>
                  ) : filteredRealTenants.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">
                        {realTenants.length === 0 ? 'Nenhum tenant cadastrado ainda.' : 'Nenhum tenant corresponde à busca/filtro.'}
                      </td>
                    </tr>
                  ) : (
                    filteredRealTenants.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3.5">
                          <div className="font-bold text-white text-sm">{t.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {t.id}{t.slug ? ` (${t.slug})` : ''}</div>
                        </td>
                        <td className="p-3.5 text-slate-300">{t.segment || '—'}</td>
                        <td className="p-3.5 text-slate-300">{t.currency} / {t.locale}</td>
                        <td className="p-3.5">
                          {t.whatsappConnected ? (
                            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Conectado
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Não conectado
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-slate-400">
                          {t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: ESTRATÉGIA DE TOKENS & ARQUITETURA SAAS */}
      {activeAdminTab === 'tokens_telemetry' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header — achado numa auditoria (14/08/2026): o botão "Ativar
              Mocking" que ficava aqui não interceptava nenhuma chamada real
              ao Gemini (nenhum lugar em server/gemini.ts ou autoReply.ts lia
              esse valor) — só mudava o próprio texto do botão. Parecia uma
              proteção de custo real, mas clicar nele não impedia gasto
              nenhum. "simulação da Gemini Batch API" na descrição também
              nunca existiu (`ai.batches` do SDK nunca é chamado em lugar
              nenhum). Removidos os dois; "Context Cache" no badge acima
              agora é real — ver geminiSystemInstructionCache.ts. */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              <h2 className="text-base font-bold text-white">Arquitetura Avançada & Gestão de Tokens Gemini</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-300 border border-purple-800">
                Pay-as-You-Go + Context Cache
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Controle de custos por tenant e resiliência com filas — Camada 1+2 do prompt (fixa por segmento) agora usa cache de contexto real do Gemini.
            </p>
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
              {/* Achado real em produção (13/08/2026): não existe uma
                  constante confiável de preço por token pro modelo em uso —
                  o backend nunca calculou isso de verdade, sempre devolvia
                  totalSaaSCostUSD=0 fixo (tokenUsageStore.ts). Mostrar
                  "$0.00000 USD" tinha a mesma cara de um custo medido; "—" é
                  honesto sobre não ter essa métrica ainda. */}
              <div className="text-2xl font-black text-slate-500">—</div>
              <p className="text-[10px] text-slate-500 font-medium">Sem preço por token confirmado ainda pro modelo em uso</p>
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
                    <th className="p-3">Requisições</th>
                    <th className="p-3">Última Atividade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {/* Achado numa auditoria: sem telemetria real ainda, esta tabela
                      mostrava duas empresas inventadas ("Clínica Sorriso Dourado",
                      "Advocacia Silva & Associados") com tokens/custos fixos no
                      código — dado de negócio fabricado, com a mesma cara de uma
                      medição real. Mostra um estado vazio honesto em vez disso.
                      Achado real em produção (13/08/2026): a coluna "Custo
                      Estimado (USD)" lia `tRecord.estimatedCostUSD.toFixed(5)`,
                      campo que o backend nunca envia por tenant (ver
                      TenantTokenSummary em tokenUsageStore.ts) — tela branca
                      assim que telemetria real (não mais vazia) chegava.
                      Removida — não existe custo real por tenant hoje. */}
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
                        <td className="p-3 font-mono text-slate-400">{tRecord.requestCount} reqs</td>
                        <td className="p-3 text-[10px] text-slate-500 font-mono">
                          {new Date(tRecord.lastRequestAt).toLocaleTimeString('pt-BR')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-xs text-slate-500">
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

      {/* TAB CONTENT: PROMPT GLOBAL DO AGENTE (Camada 1) */}
      {activeAdminTab === 'global_prompt' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Brain className="w-5 h-5 text-pink-400" />
                  Prompt Global do Agente (Camada 1)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
                  Regra fixa que vale pra TODOS os tenants/segmentos — a espinha dorsal da estrutura de vendas (fluxo de pré-reserva/pagamento, quando escalar pra humano, regras de honestidade/segurança). O texto abaixo é o que está em vigor agora; edite e salve pra sobrescrever sem precisar de deploy, ou use "Restaurar padrão" pra voltar ao texto original do código.
                </p>
              </div>
              <button
                onClick={handleLoadGlobalPrompt}
                disabled={isLoadingGlobalPrompt}
                className="py-2 px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-2 transition-all flex-shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {isLoadingGlobalPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span>Recarregar</span>
              </button>
            </div>

            {globalPromptError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs">
                {globalPromptError}
              </div>
            )}

            <div className="text-[11px] text-slate-500">
              {globalPromptContent
                ? `Override customizado em vigor${globalPromptUpdatedAt ? ` — última alteração em ${new Date(globalPromptUpdatedAt).toLocaleString('pt-BR')}` : ''}.`
                : 'Texto padrão do código em vigor (mostrado abaixo) — nenhum override salvo ainda. Edite e salve pra sobrescrever.'}
            </div>

            <textarea
              value={globalPromptDraft}
              onChange={(e) => setGlobalPromptDraft(e.target.value)}
              rows={18}
              placeholder="Carregando o texto em vigor..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-pink-500/60 resize-y"
            />

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveGlobalPrompt}
                disabled={isSavingGlobalPrompt}
                className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSavingGlobalPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Salvar</span>
              </button>
              <button
                onClick={handleResetGlobalPrompt}
                disabled={isSavingGlobalPrompt || !globalPromptContent}
                className="py-2 px-4 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-800/60 font-bold text-xs rounded-xl flex items-center gap-2 transition-all disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restaurar padrão</span>
              </button>
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
                        const tenantObj = realTenants.find((t) => t.id === usr.tenantId);
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
                              {(() => {
                                const roleColors: Record<UserRole, string> = {
                                  saas_admin: 'bg-purple-950 text-purple-300 border-purple-800',
                                  admin: 'bg-purple-950 text-purple-300 border-purple-800/80',
                                  manager: 'bg-blue-950 text-blue-300 border-blue-800/80',
                                  operator: 'bg-emerald-950 text-emerald-300 border-emerald-800/80',
                                };
                                return (
                                  <select
                                    value={usr.role}
                                    disabled={savingRoleForUserId === usr.id}
                                    onChange={(e) => handleUpdateUserRole(usr.id, e.target.value as UserRole)}
                                    title="Alterar função e permissão deste usuário"
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-wait focus:outline-none ${roleColors[usr.role]}`}
                                  >
                                    <option value="operator">Operador</option>
                                    <option value="manager">Gerente</option>
                                    <option value="admin">Administrador</option>
                                    {/* Sempre renderizada (senão uma linha já saas_admin ficaria sem
                                        opção correspondente pra quem não é saas_admin) — mas
                                        desabilitada pra quem não pode escolhê-la, mesma regra do
                                        backend (PATCH /api/admin/operators/:id). */}
                                    <option value="saas_admin" disabled={!isSaasAdminUser}>SaaS Master Admin</option>
                                  </select>
                                );
                              })()}
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

    </div>
  );
};
