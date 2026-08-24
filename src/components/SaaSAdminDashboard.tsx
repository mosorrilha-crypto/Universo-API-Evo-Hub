import React, { useState, useEffect } from 'react';
import { Tenant, UserProfile, UserRole, TenantTokenTelemetry, ProviderBreakdown, QueueSystemStatus, RoadmapItem, RoadmapPriority } from '../types';
import { apiFetch } from '../lib/apiClient';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  Building2,
  DollarSign,
  Users,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Key,
  QrCode,
  ExternalLink,
  Sparkles,
  Settings,
  Layers,
  Zap,
  X,
  Cpu,
  RefreshCw,
  Server,
  Activity,
  Brain,
  Save,
  RotateCcw,
  Loader2,
  Camera
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
  const [isRecreating, setIsRecreating] = useState(false);

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

  // Recria a instância do zero na Evolution API (delete + create) — achado
  // real (15/08/2026, Clic Piscinas): diferente de "Gerar novo QR Code"
  // (que só renova o pareamento de uma instância já saudável), isso limpa
  // estado interno do Baileys que reconectar sozinho não resolve (ex:
  // mapeamento @lid degradado pra um contato específico — issue #262).
  // Sempre exige escanear o QR de novo depois — por isso pede confirmação
  // explícita antes de disparar.
  const handleRecreateInstance = async () => {
    if (!selectedTenantId) return;
    if (!window.confirm('Isso vai apagar e recriar a instância do WhatsApp desse tenant do zero. A conexão atual cai e vai ser preciso escanear o QR Code de novo. Continuar?')) return;
    setIsRecreating(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/evolution-instance/recreate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setErrorMsg(data.warning);
      if (data.qrCodeBase64) {
        setQrCodeBase64(data.qrCodeBase64);
        setConnectionState('waiting');
      } else {
        await handleRefreshQr();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao recriar a instância.');
    } finally {
      setIsRecreating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Conectar WhatsApp via QR Code"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
      >
        <QrCode className="w-3.5 h-3.5" />
        WhatsApp QR
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsModalOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <QrCode className="w-4 h-4 text-sky-400" /> Conectar WhatsApp (Evolution API)
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{errorMsg}</div>
            )}

            {connectionState === 'connected' ? (
              <div className="text-center py-6 space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <p className="text-sm text-white font-semibold">WhatsApp conectado!</p>
                <p className="text-xs text-slate-400">O número já pode receber e enviar mensagens por esse tenant.</p>
                <button
                  type="button"
                  onClick={handleRecreateInstance}
                  disabled={isRecreating}
                  className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1.5 mx-auto disabled:opacity-50 pt-2"
                >
                  <RefreshCw className={`w-3 h-3 ${isRecreating ? 'animate-spin' : ''}`} /> {isRecreating ? 'Recriando...' : 'Mensagens não chegam mesmo conectado? Recriar instância do zero'}
                </button>
              </div>
            ) : qrCodeBase64 ? (
              <div className="text-center space-y-3">
                <img src={qrCodeBase64} alt="QR Code de conexão" className="mx-auto rounded-lg border border-slate-700 w-56 h-56 object-contain bg-white" />
                <p className="text-xs text-slate-400">Abra o WhatsApp no celular do tenant → Aparelhos conectados → Conectar um aparelho → escaneie este código.</p>
                <button
                  type="button"
                  onClick={handleRefreshQr}
                  disabled={isGeneratingQr}
                  className="text-xs text-sky-300 hover:text-sky-200 flex items-center gap-1.5 mx-auto disabled:opacity-50"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                  className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
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
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
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
        title="Gerenciar credenciais Meta CAPI"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
      >
        <Zap className="w-3.5 h-3.5" />
        Meta CAPI
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

/**
 * Instagram DM (Fase 1, pedido real 15/08/2026 — "como responder lead do
 * Instagram") — mesmo padrão de `GerenciarCredenciaisCapi` acima: entrada
 * manual do ID da conta Instagram + access token (obtidos direto no App da
 * Meta, já conectado à Página/conta certa), sem fluxo de OAuth próprio ainda
 * (fica pra uma fase seguinte se o volume justificar). Busca a lista REAL de
 * tenants (GET /api/admin/tenants), não a tabela local/mock desta tela.
 */
function GerenciarCredenciaisInstagram() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [realTenants, setRealTenants] = useState<RealTenant[]>([]);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [instagramAccountId, setInstagramAccountId] = useState('');
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

  // Nunca limpa successMsg aqui — mesmo motivo de GerenciarCredenciaisCapi
  // acima (handleSave chama isso logo depois de setar a mensagem de sucesso).
  const fetchCredentials = async (tenantId: string) => {
    if (!tenantId) return;
    setIsLoadingCreds(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/instagram-credentials`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInstagramAccountId(data.instagramAccountId || '');
      setAccessTokenSet(!!data.accessTokenSet);
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
      const res = await apiFetch(`/api/admin/tenants/${selectedTenantId}/instagram-credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instagramAccountId: instagramAccountId.trim() || undefined,
          // Em branco = manter o token já salvo (mesmo motivo de
          // GerenciarCredenciaisCapi acima).
          ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuccessMsg('Credenciais salvas! O Instagram desse tenant já pode receber e responder DM automaticamente.');
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
        title="Conectar Instagram"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-pink-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-pink-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-300/70"
      >
        <Camera className="w-3.5 h-3.5" />
        Instagram
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsModalOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <Camera className="w-4 h-4 text-pink-400" /> Instagram DM (Fase 1)
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Cole o ID da conta profissional do Instagram e o access token com permissão <code>instagram_manage_messages</code>,
              gerados no mesmo App da Meta já usado pro WhatsApp. Com isso salvo, o agente passa a responder DM do Instagram
              dessa conta automaticamente (texto, por enquanto — sem envio de foto/vídeo ainda).
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500"
              >
                {!realTenants.length && <option value="">{isLoadingTenants ? 'Carregando...' : 'Nenhum tenant cadastrado ainda'}</option>}
                {realTenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">ID da Conta Instagram</label>
                <input
                  type="text"
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  disabled={isLoadingCreds}
                  placeholder="Ex: 17841400000000000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-pink-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1.5">
                  <Key className="w-3 h-3" /> Access Token
                </label>
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  disabled={isLoadingCreds}
                  placeholder={accessTokenSet ? 'Já configurado — deixe em branco pra manter' : 'Cole o token aqui'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-pink-500 disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={!selectedTenantId || isSaving || isLoadingCreds}
                className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
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

  // Backlog técnico real (server/services/roadmapStore.ts) — achado real
  // (pedido do usuário): a aba "Roadmap Técnico & Backlog" era uma lista de
  // 4 cards fixos direto no JSX, com um badge "5 Módulos Planejados" já
  // errado (só 4 cards), impossível de editar, e itens já desatualizados
  // (ex: automação de instância WhatsApp já em boa parte implementada via
  // "Conectar WhatsApp via QR Code"). Agora é uma lista real — o saas_admin
  // adiciona pendências não-urgentes (texto + imagem opcional) conforme
  // aparecem, marca como concluída quando executada depois em lote.
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [isLoadingRoadmap, setIsLoadingRoadmap] = useState(false);
  const [roadmapLoaded, setRoadmapLoaded] = useState(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [isAddRoadmapModalOpen, setIsAddRoadmapModalOpen] = useState(false);
  const [newRoadmapTitle, setNewRoadmapTitle] = useState('');
  const [newRoadmapDescription, setNewRoadmapDescription] = useState('');
  const [newRoadmapPriority, setNewRoadmapPriority] = useState<RoadmapPriority>('media');
  const [newRoadmapImageBase64, setNewRoadmapImageBase64] = useState<string | null>(null);
  const [isSavingRoadmapItem, setIsSavingRoadmapItem] = useState(false);
  const [roadmapFormError, setRoadmapFormError] = useState<string | null>(null);
  const [busyRoadmapItemId, setBusyRoadmapItemId] = useState<string | null>(null);

  const fetchRoadmapItems = async () => {
    setIsLoadingRoadmap(true);
    setRoadmapError(null);
    try {
      const res = await apiFetch('/api/admin/roadmap-items');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoadmapItems(data.items || []);
      setRoadmapLoaded(true);
    } catch (err: any) {
      setRoadmapError(err.message || 'Falha ao carregar o backlog.');
    } finally {
      setIsLoadingRoadmap(false);
    }
  };

  useEffect(() => {
    if (activeAdminTab === 'roadmap' && !roadmapLoaded && !isLoadingRoadmap) {
      fetchRoadmapItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminTab]);

  const resetRoadmapForm = () => {
    setNewRoadmapTitle('');
    setNewRoadmapDescription('');
    setNewRoadmapPriority('media');
    setNewRoadmapImageBase64(null);
    setRoadmapFormError(null);
  };

  const handleRoadmapImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setRoadmapFormError('Selecione um arquivo de imagem.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setRoadmapFormError('Imagem muito grande — máximo de ~6MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setNewRoadmapImageBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreateRoadmapItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoadmapTitle.trim()) return;
    setIsSavingRoadmapItem(true);
    setRoadmapFormError(null);
    try {
      const res = await apiFetch('/api/admin/roadmap-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRoadmapTitle.trim(),
          description: newRoadmapDescription.trim(),
          priority: newRoadmapPriority,
          imageBase64: newRoadmapImageBase64,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRoadmapItems((prev) => [data.item, ...prev]);
      setIsAddRoadmapModalOpen(false);
      resetRoadmapForm();
    } catch (err: any) {
      setRoadmapFormError(err.message || 'Falha ao salvar a pendência.');
    } finally {
      setIsSavingRoadmapItem(false);
    }
  };

  const handleToggleRoadmapStatus = async (item: RoadmapItem) => {
    setBusyRoadmapItemId(item.id);
    try {
      const nextStatus = item.status === 'pendente' ? 'concluido' : 'pendente';
      const res = await apiFetch(`/api/admin/roadmap-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRoadmapItems((prev) => {
        const updated = prev.map((it) => (it.id === item.id ? data.item : it));
        // Reordena localmente (pendentes primeiro) igual o backend faz, sem
        // precisar recarregar a lista inteira do zero.
        return [...updated].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'pendente' ? -1 : 1;
          return 0;
        });
      });
    } catch (err: any) {
      setRoadmapError(err.message || 'Falha ao atualizar a pendência.');
    } finally {
      setBusyRoadmapItemId(null);
    }
  };

  const handleDeleteRoadmapItem = async (item: RoadmapItem) => {
    if (!window.confirm(`Apagar a pendência "${item.title}"? Essa ação não pode ser desfeita.`)) return;
    setBusyRoadmapItemId(item.id);
    try {
      const res = await apiFetch(`/api/admin/roadmap-items/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRoadmapItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err: any) {
      setRoadmapError(err.message || 'Falha ao apagar a pendência.');
    } finally {
      setBusyRoadmapItemId(null);
    }
  };

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
    summary: { totalSaaSTokens: number; totalSaaSCostUSD: number; totalCachedSaved: number; totalCacheSavingsUSD: number; totalRequests: number; providerBreakdown: ProviderBreakdown };
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
    <div className="saas-workspace space-y-4 animate-fade-in">
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
      <div className="saas-workspace__banner bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          Controle de empresas cadastradas, conexões de WhatsApp e cotas de IA Gemini.
        </p>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="saas-workspace__tabs responsive-tab-strip flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveAdminTab('tenants')}
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-2 transition-all ${
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
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-2 transition-all cursor-pointer ${
            activeAdminTab === 'users'
              ? 'bg-sky-600 text-white shadow-md shadow-sky-950/30'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Gerenciador de Usuários ({usersList.length})</span>
        </button>

        <button
          onClick={() => setActiveAdminTab('roadmap')}
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-2 transition-all cursor-pointer ${
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
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-2 transition-all cursor-pointer ${
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
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-2 transition-all cursor-pointer ${
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
        <div className="space-y-4">
          <div className="saas-workspace__metrics grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl shadow-none">
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

            <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl shadow-none">
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

          <div className="bg-slate-900/75 border border-slate-800/70 rounded-2xl p-3.5 shadow-none space-y-3.5 sm:p-4">
            <div className="flex flex-col items-start justify-between gap-2.5 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-bold text-white">Lista de Clientes SaaS (Tenants Cadastrados)</h2>
                <p className="text-xs text-slate-400">Empresas reais cadastradas no banco — cada linha corresponde a um tenant de verdade.</p>
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar empresa..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                </div>

                <select
                  value={segmentFilter}
                  onChange={(e) => setSegmentFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 sm:w-auto"
                >
                  <option value="all">Todos os Segmentos</option>
                  {knownSegments.map((seg) => (
                    <option key={seg} value={seg}>{seg}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800/70 pt-2.5" aria-label="Ações de conexão">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Conexões</span>
              <GerenciarCredenciaisCapi />
              <GerenciarCredenciaisInstagram />
              <ConectarEvolutionQrCode />
            </div>

            {isLoadingRealTenants ? (
              <div className="rounded-xl bg-slate-950/35 px-4 py-8 text-center text-xs text-slate-500">Carregando tenants...</div>
            ) : filteredRealTenants.length === 0 ? (
              <div className="rounded-xl bg-slate-950/35 px-4 py-8 text-center text-xs text-slate-500">
                {realTenants.length === 0 ? 'Nenhum tenant cadastrado ainda.' : 'Nenhum tenant corresponde à busca/filtro.'}
              </div>
            ) : (
              <>
                <div className="space-y-2 sm:hidden">
                  {filteredRealTenants.map((t) => (
                    <article key={t.id} className="rounded-xl bg-slate-950/45 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-white">{t.name}</h3>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{t.slug || t.id}</p>
                        </div>
                        {t.whatsappConnected ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> Conectado
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-800/70 px-2 py-1 text-[10px] font-semibold text-slate-400">
                            <AlertCircle className="h-3 w-3" /> Offline
                          </span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-slate-400">
                        <span><span className="mr-1 uppercase tracking-wide text-slate-600">Segmento</span>{t.segment || '—'}</span>
                        <span><span className="mr-1 uppercase tracking-wide text-slate-600">Moeda</span>{t.currency} / {t.locale}</span>
                        <span><span className="mr-1 uppercase tracking-wide text-slate-600">Criado</span>{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}</span>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="responsive-table-scroll hidden overflow-x-auto sm:block">
                  <table className="min-w-[680px] w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
                      <tr>
                        <th className="p-3">Empresa / Tenant</th>
                        <th className="p-3">Segmento</th>
                        <th className="p-3">Moeda / Idioma</th>
                        <th className="p-3">WhatsApp</th>
                        <th className="p-3">Criado em</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {filteredRealTenants.map((t) => (
                        <tr key={t.id} className="transition-colors hover:bg-slate-800/50">
                          <td className="p-3">
                            <div className="text-sm font-bold text-white">{t.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">ID: {t.id}{t.slug ? ` (${t.slug})` : ''}</div>
                          </td>
                          <td className="p-3 text-slate-300">{t.segment || '—'}</td>
                          <td className="p-3 text-slate-300">{t.currency} / {t.locale}</td>
                          <td className="p-3">
                            {t.whatsappConnected ? (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Conectado</span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] text-slate-500"><AlertCircle className="h-3 w-3" /> Não conectado</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
              <Cpu className="w-5 h-5 text-sky-400" />
              <h2 className="text-base font-bold text-white">Arquitetura Avançada & Gestão de Tokens Gemini</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-950 text-sky-300 border border-sky-800">
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
                <Cpu className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-black text-white">
                {telemetryData ? telemetryData.summary.totalSaaSTokens.toLocaleString('pt-BR') : '—'}
              </div>
              {/* Router fallback Groq (plano aprovado): split por provedor pra
                  não esconder dentro de um total combinado quanto cada um
                  está sendo usado de verdade — ver tokenUsageStore.ts. */}
              {telemetryData ? (
                <p className="text-[10px] text-slate-400">
                  Gemini {telemetryData.summary.providerBreakdown.gemini.tokens.toLocaleString('pt-BR')} · Groq{' '}
                  {telemetryData.summary.providerBreakdown.groq.tokens.toLocaleString('pt-BR')}
                </p>
              ) : (
                <p className="text-[10px] text-sky-300">Medido via objeto `usageMetadata` do Gemini/Groq</p>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Custo Estimado (Gemini + Groq)</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              {/* Calculado a partir do preço confirmado por 1M tokens do
                  modelo em uso (server/services/modelPricing.ts), aplicado
                  linha a linha na data de cada chamada — nunca um preço
                  genérico "por token" sem fonte (ver comentário no arquivo
                  de pricing pra fonte/data de checagem de cada preço). */}
              <div className="text-2xl font-black text-emerald-400">
                {telemetryData ? `$${telemetryData.summary.totalSaaSCostUSD.toFixed(4)}` : '—'}
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                {telemetryData
                  ? `G $${telemetryData.summary.providerBreakdown.gemini.costUSD.toFixed(4)} · Q $${telemetryData.summary.providerBreakdown.groq.costUSD.toFixed(4)}`
                  : 'Preço confirmado por 1M tokens (ai.google.dev/gemini-api/docs/pricing)'}
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Tokens Economizados (Cache)</span>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-amber-400">
                {telemetryData ? telemetryData.summary.totalCachedSaved.toLocaleString('pt-BR') : '—'}
              </div>
              <p className="text-[10px] text-amber-300 font-medium">
                {telemetryData
                  ? `Economia estimada: $${telemetryData.summary.totalCacheSavingsUSD.toFixed(4)} via Context Caching`
                  : 'Até 90% de desconto via Context Caching'}
              </p>
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
                  <Server className="w-4 h-4 text-sky-400" />
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
                    <th className="p-3">Provedor (Gemini / Groq)</th>
                    <th className="p-3">Última Atividade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {/* Achado numa auditoria: sem telemetria real ainda, esta tabela
                      mostrava duas empresas inventadas ("Clínica Sorriso Dourado",
                      "Advocacia Silva & Associados") com tokens/custos fixos no
                      código — dado de negócio fabricado, com a mesma cara de uma
                      medição real. Mostra um estado vazio honesto em vez disso.
                      A coluna "Custo Estimado (USD)" chegou a existir e causar
                      tela branca real em produção (13/08/2026) porque o backend
                      nunca enviava `estimatedCostUSD` — agora o backend calcula
                      esse valor de verdade (server/services/modelPricing.ts) e
                      sempre o envia como número, então a coluna voltou. */}
                  {telemetryData && telemetryData.tenantsTelemetry.length > 0 ? (
                    telemetryData.tenantsTelemetry.map((tRecord) => (
                      <tr key={tRecord.tenantId} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">
                          {tRecord.tenantName}
                          <div className="text-[10px] text-slate-500 font-mono">{tRecord.tenantId}</div>
                        </td>
                        <td className="p-3 font-mono text-slate-300">{tRecord.promptTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono text-sky-300">{tRecord.candidatesTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono font-bold text-emerald-400">{tRecord.totalTokens.toLocaleString()}</td>
                        <td className="p-3 font-mono text-amber-400">{tRecord.cachedTokensSaved.toLocaleString()}</td>
                        <td className="p-3 font-mono font-bold text-emerald-400">${tRecord.estimatedCostUSD.toFixed(4)}</td>
                        <td className="p-3 font-mono text-slate-400">{tRecord.requestCount} reqs</td>
                        <td className="p-3 font-mono text-[10px]">
                          <span className="text-blue-300">G {tRecord.providerBreakdown.gemini.tokens.toLocaleString('pt-BR')}</span>
                          {' / '}
                          <span className="text-orange-300">Q {tRecord.providerBreakdown.groq.tokens.toLocaleString('pt-BR')}</span>
                        </td>
                        <td className="p-3 text-[10px] text-slate-500 font-mono">
                          {new Date(tRecord.lastRequestAt).toLocaleTimeString('pt-BR')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-xs text-slate-500">
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
                    <Settings className="w-4 h-4 text-sky-400" />
                    Guia de Migração: Google Cloud Vertex AI
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Passos recomendados para escala comercial enterprise e cota reservada.
                  </p>
                </div>
                <span className="px-2 py-0.5 text-[10px] bg-sky-950 text-sky-300 border border-sky-800 font-bold rounded-md">
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
                  <CheckCircle2 className="w-4 h-4 text-sky-400" />
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
                  className="mt-3 inline-flex items-center space-x-1.5 text-xs text-sky-400 hover:text-sky-300 font-bold"
                >
                  <span>Acessar Console do Google Cloud Quotas</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: ROADMAP TÉCNICO — achado real (pedido do usuário): era
          uma lista de 4 cards fixos direto no JSX, com um badge "5 Módulos
          Planejados" já errado (só 4 cards renderizados), impossível de
          editar pelo painel, e itens já desatualizados (ex: "Automação
          Zero-Touch de Instâncias WhatsApp" já em boa parte implementada via
          "Conectar WhatsApp via QR Code", Epic 4.6). Backlog real agora —
          ver server/services/roadmapStore.ts. */}
      {activeAdminTab === 'roadmap' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-sky-400" />
                  Lista de Pendências & Roadmap Técnico (Implementações Não-Urgentes)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Adicione pendências conforme aparecem, com prioridade e uma imagem de referência se ajudar — depois executamos tudo em lote.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs bg-sky-950 text-sky-300 border border-sky-800 px-3 py-1 rounded-xl font-semibold">
                  {roadmapItems.filter((i) => i.status === 'pendente').length} Pendente{roadmapItems.filter((i) => i.status === 'pendente').length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    resetRoadmapForm();
                    setIsAddRoadmapModalOpen(true);
                  }}
                  className="py-2 px-3.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-950/40 flex items-center gap-2 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova Pendência</span>
                </button>
              </div>
            </div>

            {roadmapError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs">{roadmapError}</div>
            )}

            {isLoadingRoadmap ? (
              <div className="text-center text-xs text-slate-500 py-10">Carregando backlog...</div>
            ) : roadmapItems.length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-10">
                Nenhuma pendência cadastrada ainda — clique em "Nova Pendência" pra adicionar a primeira.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roadmapItems.map((item) => {
                  const priorityStyle =
                    item.priority === 'alta'
                      ? 'bg-rose-950 text-rose-300 border-rose-800'
                      : item.priority === 'media'
                      ? 'bg-amber-950 text-amber-400 border-amber-800'
                      : 'bg-slate-800 text-slate-400 border-slate-700';
                  const priorityLabel = item.priority === 'alta' ? 'Alta Prioridade' : item.priority === 'media' ? 'Média Prioridade' : 'Baixa Prioridade';
                  const isConcluded = item.status === 'concluido';
                  const isBusy = busyRoadmapItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`bg-slate-950 border rounded-xl p-4 space-y-2 ${isConcluded ? 'border-slate-800/60 opacity-60' : 'border-slate-800'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-bold ${isConcluded ? 'text-slate-400 line-through' : 'text-white'}`}>{item.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border flex-shrink-0 ${priorityStyle}`}>{priorityLabel}</span>
                      </div>
                      {item.description && <p className="text-xs text-slate-300">{item.description}</p>}
                      {item.imageBase64 && (
                        <img src={item.imageBase64} alt={item.title} className="w-full max-h-48 object-cover rounded-lg border border-slate-800" />
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500">
                          {isConcluded ? 'Concluída' : 'Pendente'} • {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleRoadmapStatus(item)}
                            disabled={isBusy}
                            title={isConcluded ? 'Reabrir pendência' : 'Marcar como concluída'}
                            className="p-1.5 bg-slate-800 hover:bg-emerald-950/60 hover:text-emerald-300 text-slate-400 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {isConcluded ? <RotateCcw className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRoadmapItem(item)}
                            disabled={isBusy}
                            title="Apagar pendência"
                            className="p-1.5 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                  <Users className="w-5 h-5 text-sky-400" />
                  Gerenciador de Usuários e Operadores do Sistema
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cadastre novos usuários, altere permissões de acesso e gerencie os operadores por empresa (Tenant)
                </p>
              </div>

              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-950/40 flex items-center space-x-2 transition-all cursor-pointer"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-xs text-slate-400">Filtrar Função:</span>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                                  saas_admin: 'bg-sky-950 text-sky-300 border-sky-800',
                                  admin: 'bg-sky-950 text-sky-300 border-sky-800/80',
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
              <div className="p-3 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20">
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer mt-4"
              >
                <Users className="w-4 h-4" />
                <span>{isSavingUser ? 'Salvando...' : 'Salvar e Cadastrar Usuário'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* NEW ROADMAP ITEM MODAL */}
      {isAddRoadmapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-5">
            <button
              onClick={() => setIsAddRoadmapModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
              <div className="p-3 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Nova Pendência no Backlog</h2>
                <p className="text-xs text-slate-400">Fica salva pra executarmos depois, sem urgência</p>
              </div>
            </div>

            <form onSubmit={handleCreateRoadmapItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Título</label>
                <input
                  type="text"
                  value={newRoadmapTitle}
                  onChange={(e) => setNewRoadmapTitle(e.target.value)}
                  placeholder="Ex: Exportador de relatórios financeiros"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Descrição</label>
                <AutoResizeTextarea
                  value={newRoadmapDescription}
                  onChange={(e) => setNewRoadmapDescription(e.target.value)}
                  minRows={4}
                  placeholder="Detalhe o que precisa ser feito..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Prioridade</label>
                <select
                  value={newRoadmapPriority}
                  onChange={(e) => setNewRoadmapPriority(e.target.value as RoadmapPriority)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Imagem de referência (opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleRoadmapImageChange}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200 file:text-xs file:font-semibold hover:file:bg-slate-700 cursor-pointer"
                />
                {newRoadmapImageBase64 && (
                  <img src={newRoadmapImageBase64} alt="Pré-visualização" className="mt-2 max-h-40 rounded-lg border border-slate-800" />
                )}
              </div>

              {roadmapFormError && (
                <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{roadmapFormError}</p>
              )}

              <button
                type="submit"
                disabled={isSavingRoadmapItem || !newRoadmapTitle.trim()}
                className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isSavingRoadmapItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{isSavingRoadmapItem ? 'Salvando...' : 'Adicionar ao Backlog'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
