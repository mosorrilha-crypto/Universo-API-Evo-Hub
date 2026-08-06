import React, { useState } from 'react';
import { Tenant } from '../types';
import {
  Zap,
  Key,
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  Send,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  Shield,
  Layers,
  FileText,
  Activity,
  Server,
  Lock,
  Smartphone
} from 'lucide-react';

interface EvoHubIntegrationProps {
  activeTenant: Tenant;
  showToast: (msg: string) => void;
}

interface EvoChannel {
  id: string;
  name: string;
  type: 'whatsapp' | 'facebook' | 'instagram' | 'unified';
  status: 'active' | 'inactive' | 'pending';
  token: string;
  external_id?: string;
  metadata?: any;
  created_at: string;
}

interface EvoWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'active' | 'inactive';
}

interface EvoTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export const EvoHubIntegration: React.FC<EvoHubIntegrationProps> = ({ activeTenant, showToast }) => {
  // Configuration State
  const [hubUrl, setHubUrl] = useState<string>('https://api.evohub.ai');
  const [apiKey, setApiKey] = useState<string>('evh_pk_abc123def4567890789abc123def4567');
  const [webhookSecret, setWebhookSecret] = useState<string>('evo_sec_998877665544332211');
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);

  // Active Sub-tab
  const [activeSubTab, setActiveSubTab] = useState<'channels' | 'proxy' | 'webhooks' | 'templates' | 'stats'>('channels');

  // Channels State
  const [channels, setChannels] = useState<EvoChannel[]>([
    {
      id: 'ch_uuid_whatsapp_01',
      name: 'Monique Sorrilha Studio - WhatsApp Principal',
      type: 'whatsapp',
      status: 'active',
      token: '3b7fbadc92ba518a24055abfbf80106a581834c2cd2569bba63df67d90859caa',
      metadata: {
        meta_connection: {
          phone_number_id: '120802557652706',
          waba_id: '104706592613608',
          phone_number: '+595 981 123456',
          display_name: 'Monique Sorrilha Beauty'
        }
      },
      created_at: new Date().toISOString()
    }
  ]);

  // New Channel Modal
  const [isNewChannelModalOpen, setIsNewChannelModalOpen] = useState<boolean>(false);
  const [newChannelName, setNewChannelName] = useState<string>('Atendimento Instagram & WhatsApp');
  const [newChannelType, setNewChannelType] = useState<'whatsapp' | 'facebook' | 'instagram'>('whatsapp');
  const [selectedChannelForPublicLink, setSelectedChannelForPublicLink] = useState<EvoChannel | null>(null);

  // Proxy Test State
  const [proxyEndpoint, setProxyEndpoint] = useState<string>('/v23.0/120802557652706/messages');
  const [proxyMethod, setProxyMethod] = useState<'GET' | 'POST'>('POST');
  const [proxyPayload, setProxyPayload] = useState<string>(
    JSON.stringify(
      {
        messaging_product: 'whatsapp',
        to: '595981123456',
        type: 'text',
        text: { body: 'Olá! Confirmação de agendamento no Monique Sorrilha Studio via Evo Hub.' }
      },
      null,
      2
    )
  );
  const [proxyToken, setProxyToken] = useState<string>('3b7fbadc92ba518a24055abfbf80106a581834c2cd2569bba63df67d90859caa');
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [isProxyLoading, setIsProxyLoading] = useState<boolean>(false);

  // Webhooks State
  const [webhooks, setWebhooks] = useState<EvoWebhook[]>([
    {
      id: 'wh_uuid_01',
      name: 'CRM Webhook Principal',
      url: `${window.location.origin}/api/webhooks/evolution_hub`,
      events: ['channel_connected', 'event_received', 'webhook_delivered'],
      status: 'active'
    }
  ]);
  const [newWebhookName, setNewWebhookName] = useState<string>('Webhook de Leads');
  const [newWebhookUrl, setNewWebhookUrl] = useState<string>('https://crm.moniquesorrilha.com/hook');

  // Templates State
  const [templates, setTemplates] = useState<EvoTemplate[]>([
    { id: 't_1', name: 'confirmacao_seia', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED' },
    { id: 't_2', name: 'lembrete_procedimento', language: 'es_PY', category: 'UTILITY', status: 'APPROVED' }
  ]);
  const [newTemplateName, setNewTemplateName] = useState<string>('agendamento_labial');

  // Copied state
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTokenId(id);
    showToast('Copiado para a área de transferência!');
    setTimeout(() => setCopiedTokenId(null), 2000);
  };

  const handleCreateChannel = (e: React.FormEvent) => {
    e.preventDefault();
    const newChan: EvoChannel = {
      id: `ch_${Date.now()}`,
      name: newChannelName,
      type: newChannelType,
      status: 'inactive',
      token: `ch_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`,
      created_at: new Date().toISOString()
    };
    setChannels([newChan, ...channels]);
    setIsNewChannelModalOpen(false);
    showToast('Canal criado com sucesso! Gere o link público para conectar à Meta.');
  };

  const handleDeleteChannel = (id: string) => {
    setChannels(channels.filter((c) => c.id !== id));
    showToast('Canal removido do Evo Hub.');
  };

  const handleTestProxy = async () => {
    setIsProxyLoading(true);
    setProxyResult(null);
    try {
      // Simulate Evo Hub proxy /meta/* call
      await new Promise((r) => setTimeout(r, 800));
      const simulatedResponse = {
        success: true,
        status: 200,
        gateway: 'Evo Hub Proxy (/meta/*)',
        forwarded_to: `https://graph.facebook.com${proxyEndpoint}`,
        response: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '595981123456', wa_id: '595981123456' }],
          messages: [{ id: `wamid.HBgLNTk1OTgx${Math.floor(Math.random() * 1000000000)}` }]
        },
        metrics: {
          latency_ms: 142,
          cache_hit: false,
          token_type: 'channel_token_injected_to_meta_eaa'
        }
      };
      setProxyResult(JSON.stringify(simulatedResponse, null, 2));
      showToast('Requisição Proxy executada com sucesso via Evo Hub!');
    } catch (err: any) {
      setProxyResult(JSON.stringify({ error: err.message || 'Proxy error' }, null, 2));
    } finally {
      setIsProxyLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* HEADER BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-inner">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white">Evo Hub (Meta API Gateway & Proxy)</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-300 border border-purple-800">
                Ativo & Sincronizado
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Gerencie conexões seguras WhatsApp Cloud, Facebook e Instagram sem armazenar tokens longos da Meta.
            </p>
          </div>
        </div>

        {/* CREDENTIALS QUICK STATUS */}
        <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
          <div className="text-xs">
            <div className="text-slate-400">API Key Configurada:</div>
            <div className="font-mono font-bold text-white text-[11px]">{apiKey.substring(0, 16)}...</div>
          </div>
        </div>
      </div>

      {/* CONFIGURATION BAR (API KEY & URL) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-purple-400" />
            Configuração de Acesso ao Evo Hub
          </h3>
          <span className="text-[11px] text-slate-400">Host: {hubUrl}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Evo Hub Base URL</label>
            <input
              type="text"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-mono focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">API Key (evh_pk_...)</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-mono focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">Webhook Secret (HMAC)</label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-mono focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>

      {/* SUB-TABS NAVIGATION */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('channels')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
            activeSubTab === 'channels'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Layers className="w-4 h-4 text-purple-300" />
          <span>Canais / Conexões Meta ({channels.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('proxy')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
            activeSubTab === 'proxy'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Server className="w-4 h-4 text-purple-300" />
          <span>Testar Proxy Meta (/meta/*)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('webhooks')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
            activeSubTab === 'webhooks'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Activity className="w-4 h-4 text-purple-300" />
          <span>Webhooks & Eventos ({webhooks.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('templates')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
            activeSubTab === 'templates'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <FileText className="w-4 h-4 text-purple-300" />
          <span>Templates WhatsApp ({templates.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('stats')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
            activeSubTab === 'stats'
              ? 'bg-purple-600 text-white shadow'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Shield className="w-4 h-4 text-purple-300" />
          <span>Dashboard & Estatísticas</span>
        </button>
      </div>

      {/* SUB-TAB 1: CHANNELS */}
      {activeSubTab === 'channels' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Conexões Ativas com a Meta</h3>
              <p className="text-xs text-slate-400">Cada canal emite um Channel Token usado pelo proxy para autenticar na Graph API.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsNewChannelModalOpen(true)}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl flex items-center space-x-2 shadow transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Nova Conexão (Canal)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {channels.map((chan) => (
              <div key={chan.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400 font-bold">
                      {chan.type === 'whatsapp' ? <Smartphone className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{chan.name}</div>
                      <div className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">
                        Tipo: {chan.type} • ID: {chan.id}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      chan.status === 'active'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}
                  >
                    {chan.status === 'active' ? 'Conectado (Active)' : 'Inativo (Inactive)'}
                  </span>
                </div>

                {chan.metadata?.meta_connection && (
                  <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs space-y-1 font-mono text-slate-300">
                    <div>📱 Número: {chan.metadata.meta_connection.phone_number}</div>
                    <div>🔑 Phone ID: {chan.metadata.meta_connection.phone_number_id}</div>
                    <div>🏢 WABA ID: {chan.metadata.meta_connection.waba_id}</div>
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] text-slate-400 font-semibold block">Channel Token (Bearer p/ /meta/*):</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="password"
                      readOnly
                      value={chan.token}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-lg p-2 font-mono"
                    />
                    <button
                      onClick={() => handleCopy(chan.token, chan.id)}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs"
                      title="Copiar Channel Token"
                    >
                      {copiedTokenId === chan.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChannelForPublicLink(chan);
                      showToast(`Link público gerado: https://app.evohub.ai/connect/${chan.token}`);
                    }}
                    className="text-xs text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ver Link de Conexão Público</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteChannel(chan.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg transition-all"
                    title="Excluir Canal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedChannelForPublicLink && (
            <div className="bg-purple-950/40 border border-purple-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-purple-400" />
                  Link Público de Conexão Meta para: {selectedChannelForPublicLink.name}
                </h4>
                <button
                  onClick={() => setSelectedChannelForPublicLink(null)}
                  className="text-slate-400 hover:text-white text-xs font-bold"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-slate-300">
                Envie este link para o cliente final. Ao abri-lo, ele fará login na Meta (Embedded Signup) e a conexão será ativada automaticamente no Hub:
              </p>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={`https://app.evohub.ai/connect/${selectedChannelForPublicLink.token}`}
                  className="w-full bg-slate-950 border border-purple-800 text-purple-200 text-xs rounded-xl p-2.5 font-mono"
                />
                <button
                  onClick={() => handleCopy(`https://app.evohub.ai/connect/${selectedChannelForPublicLink.token}`, 'publink')}
                  className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Link</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: PROXY TESTER */}
      {activeSubTab === 'proxy' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-purple-400" />
              Testador do Proxy Meta (`/meta/*`)
            </h3>
            <p className="text-xs text-slate-400">
              Simule chamadas server-to-server para a Graph API da Meta usando o Evo Hub como gateway de injeção de tokens.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Método HTTP</label>
              <select
                value={proxyMethod}
                onChange={(e) => setProxyMethod(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-bold"
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-semibold mb-1">Endpoint Proxy (`/meta/...`)</label>
              <input
                type="text"
                value={proxyEndpoint}
                onChange={(e) => setProxyEndpoint(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-mono"
              />
            </div>
          </div>

          <div className="text-xs space-y-1">
            <label className="block text-slate-400 font-semibold">Channel Token (Header Authorization: Bearer ...)</label>
            <input
              type="text"
              value={proxyToken}
              onChange={(e) => setProxyToken(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-purple-300 rounded-xl p-2.5 font-mono text-xs"
            />
          </div>

          <div className="text-xs space-y-1">
            <label className="block text-slate-400 font-semibold">Payload JSON (Request Body)</label>
            <textarea
              rows={6}
              value={proxyPayload}
              onChange={(e) => setProxyPayload(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-emerald-300 rounded-xl p-3 font-mono text-xs"
            />
          </div>

          <button
            type="button"
            onClick={handleTestProxy}
            disabled={isProxyLoading}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-2 shadow transition-all"
          >
            <Send className={`w-4 h-4 ${isProxyLoading ? 'animate-bounce' : ''}`} />
            <span>{isProxyLoading ? 'Enviando via Evo Hub Proxy...' : 'Executar Requisição no Proxy'}</span>
          </button>

          {proxyResult && (
            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-slate-300">Resposta Retornada pelo Evo Hub Proxy:</label>
              <pre className="bg-slate-950 border border-slate-800 text-emerald-400 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-80">
                {proxyResult}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: WEBHOOKS */}
      {activeSubTab === 'webhooks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Gestão de Webhooks do Hub</h3>
              <p className="text-xs text-slate-400">Receba notificações em tempo real assinadas com HMAC-SHA256 (`X-Hub-Signature-256`).</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {webhooks.map((wh) => (
              <div key={wh.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">{wh.name}</div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {wh.status}
                  </span>
                </div>
                <div className="text-xs text-slate-300 font-mono bg-slate-950 p-2.5 rounded-xl border border-slate-800 truncate">
                  {wh.url}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {wh.events.map((ev, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 text-[10px] font-mono border border-purple-800">
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: TEMPLATES */}
      {activeSubTab === 'templates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Templates de Mensagem do WhatsApp</h3>
              <p className="text-xs text-slate-400">Sincronizados diretamente com a WABA da Meta através da camada high-level do Evo Hub.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tpl) => (
              <div key={tpl.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white font-mono">{tpl.name}</div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {tpl.status}
                  </span>
                </div>
                <div className="text-xs text-slate-400 flex items-center space-x-3">
                  <span>Idioma: {tpl.language}</span>
                  <span>Categoria: {tpl.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: STATS */}
      {activeSubTab === 'stats' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-2">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Canais Ativos</div>
            <div className="text-3xl font-black text-white">{channels.length}</div>
            <div className="text-[11px] text-emerald-400">100% online no Proxy</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-2">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Requisições Proxy (24h)</div>
            <div className="text-3xl font-black text-purple-400">14,285</div>
            <div className="text-[11px] text-purple-300">Latência média: 138ms</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-2">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Webhooks Entregues</div>
            <div className="text-3xl font-black text-emerald-400">99.98%</div>
            <div className="text-[11px] text-slate-400">0 falhas por HMAC mismatch</div>
          </div>
        </div>
      )}

      {/* NEW CHANNEL MODAL */}
      {isNewChannelModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Criar Nova Conexão no Evo Hub</h3>
              <button onClick={() => setIsNewChannelModalOpen(false)} className="text-slate-400 hover:text-white font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateChannel} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Nome do Canal</label>
                <input
                  type="text"
                  required
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-semibold focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Plataforma Meta</label>
                <select
                  value={newChannelType}
                  onChange={(e) => setNewChannelType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-bold"
                >
                  <option value="whatsapp">WhatsApp Business API</option>
                  <option value="facebook">Facebook Messenger</option>
                  <option value="instagram">Instagram Direct</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewChannelModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow"
                >
                  Criar Conexão Canal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
