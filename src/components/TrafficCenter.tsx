import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Eye,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type DatePreset = 'today' | 'last_7d' | 'last_14d' | 'last_30d';
type DeliveryStatus = 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';

interface MetaAdsConnection {
  adAccountId: string | null;
  accessTokenSet: boolean;
  configured: boolean;
}

interface TrafficAd {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string;
  adSetName: string;
  deliveryStatus: DeliveryStatus;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
}

interface TrafficCampaign {
  id: string;
  name: string;
  deliveryStatus: DeliveryStatus;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  adsCount: number;
  activeAdsCount: number;
  pendingReviewAdsCount: number;
  disapprovedAdsCount: number;
}

interface TrafficOverview {
  datePreset: DatePreset;
  dateStart: string | null;
  dateStop: string | null;
  accountId: string;
  currency: string;
  lastUpdatedAt: string;
  summary: {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number | null;
    cpc: number | null;
    messagingConversations: number;
    costPerMessagingConversation: number | null;
    activeAdsCount: number;
    pendingReviewAdsCount: number;
    disapprovedAdsCount: number;
  };
  campaigns: TrafficCampaign[];
  ads: TrafficAd[];
  warnings: string[];
}

const PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_14d', label: '14 dias' },
  { value: 'last_30d', label: '30 dias' },
];

const statusPresentation: Record<DeliveryStatus, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  paused: { label: 'Pausado', className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  pending_review: { label: 'Em análise', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  disapproved: { label: 'Reprovado', className: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  inactive: { label: 'Inativo', className: 'bg-slate-700 text-slate-400 border-slate-600' },
  unknown: { label: 'Sem status', className: 'bg-slate-700 text-slate-400 border-slate-600' },
};

function money(value: number | null | undefined, currency = 'BRL'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function percentage(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2).replace('.', ',')}%`;
}

function ranking(value: string | null): string {
  if (!value) return 'Não disponível';
  const labels: Record<string, string> = {
    ABOVE_AVERAGE: 'Acima da média',
    AVERAGE: 'Na média',
    BELOW_AVERAGE_10: 'Abaixo da média (10%)',
    BELOW_AVERAGE_20: 'Abaixo da média (20%)',
    BELOW_AVERAGE_35: 'Abaixo da média (35%)',
  };
  return labels[value] || value.replaceAll('_', ' ');
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const MetricCard: React.FC<{ label: string; value: string; detail: string; icon: React.ReactNode; tone?: 'emerald' | 'blue' | 'amber' | 'purple' }> = ({ label, value, detail, icon, tone = 'emerald' }) => {
  const tones = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  };
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className={`p-2 rounded-xl border ${tones[tone]}`}>{icon}</span>
      </div>
      <p className="mt-4 text-2xl font-bold text-white tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
};

export const TrafficCenter: React.FC = () => {
  const [connection, setConnection] = useState<MetaAdsConnection | null>(null);
  const [overview, setOverview] = useState<TrafficOverview | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('last_30d');
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingConnection, setIsEditingConnection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const fetchConnection = async () => {
    setIsLoadingConnection(true);
    try {
      const response = await apiFetch('/api/meta-ads/connection');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível verificar a conexão com Meta Ads.');
      setConnection(data.connection);
      setAdAccountId(data.connection.adAccountId || '');
    } catch (requestError: any) {
      setError(requestError.message || 'Não foi possível verificar a conexão com Meta Ads.');
    } finally {
      setIsLoadingConnection(false);
    }
  };

  useEffect(() => { void fetchConnection(); }, []);

  const refreshMetrics = async (preset = datePreset) => {
    setIsRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/meta-ads/insights?datePreset=${preset}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'A Meta não retornou as métricas solicitadas.');
      setOverview(data.overview);
      setNotice('Métricas atualizadas com dados reais da Meta.');
    } catch (requestError: any) {
      setError(requestError.message || 'Não foi possível atualizar as métricas.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (overview) void refreshMetrics(preset);
  };

  const saveConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch('/api/meta-ads/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountId, ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar a conexão Meta Ads.');
      setConnection(data.connection);
      setAccessToken('');
      setIsEditingConnection(false);
      setNotice('Conexão protegida salva. Agora você pode atualizar as métricas.');
      await refreshMetrics();
    } catch (requestError: any) {
      setError(requestError.message || 'Não foi possível salvar a conexão Meta Ads.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingConnection) {
    return <div className="p-8 text-sm text-slate-400">Verificando a conexão segura com a conta Meta Ads…</div>;
  }

  const isConfigured = Boolean(connection?.configured);
  const currency = overview?.currency || 'BRL';
  const summary = overview?.summary;

  return (
    <div className="space-y-6">
      <section className="bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-2">
              <span className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"><BarChart3 className="w-6 h-6" /></span>
              <h2 className="text-2xl font-bold tracking-tight text-white">Central de Tráfego</h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              Acompanhe as campanhas de WhatsApp sem abrir o Gerenciador: investimento, conversas iniciadas, custo por conversa, criativos e situação de entrega. A atualização é manual e sempre informa quando os dados foram consultados.
            </p>
          </div>
          {isConfigured && (
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void refreshMetrics()}
                disabled={isRefreshing}
                className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Atualizando dados reais…' : 'Atualizar métricas'}
              </button>
              <button
                onClick={() => { setIsEditingConnection(true); setError(null); setNotice(null); }}
                className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <Settings2 className="w-4 h-4 text-emerald-400" />
                Configurar acesso
              </button>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-100 text-sm flex gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-300" />
          <div className="space-y-2">
            <p>{error}</p>
            {error.includes('ads_read') && (
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex font-semibold text-rose-200 underline decoration-rose-300/70 underline-offset-4 hover:text-white"
              >
                Gerar token de leitura na Meta
              </a>
            )}
          </div>
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-100 text-sm flex gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-300" />
          <p>{notice}</p>
        </div>
      )}

      {(!isConfigured || isEditingConnection) ? (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-3xl space-y-5">
          <div className="flex gap-3">
            <span className="p-2.5 h-fit rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300"><Settings2 className="w-5 h-5" /></span>
            <div>
              <h3 className="text-lg font-bold text-white">{isConfigured ? 'Atualizar acesso de leitura' : 'Conectar a leitura de campanhas'}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">Informe a conta de anúncios e um token da Marketing API com permissão de leitura de anúncios. O token é salvo apenas no servidor, nunca aparece novamente no painel e não será usado para criar, pausar ou editar campanhas.</p>
            </div>
          </div>
          <form onSubmit={saveConnection} className="space-y-4">
            <div>
              <label className="block mb-1.5 text-xs font-semibold text-slate-300">Conta de anúncios</label>
              <input value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} placeholder="act_677275869339059" required className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-semibold text-slate-300">Token da Marketing API com permissão de leitura</label>
              <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="EAAG…" required={!connection?.accessTokenSet || isEditingConnection} autoComplete="new-password" className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500" />
              <p className="mt-1.5 text-[11px] text-slate-500">A permissão necessária é <strong className="text-slate-300">ads_read</strong>. Se o mesmo token da CAPI já tiver essa permissão, ele pode ser reutilizado.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={isSaving} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition-all">
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {isSaving ? 'Salvando conexão…' : 'Salvar conexão protegida'}
              </button>
              {isConfigured && <button type="button" onClick={() => { setIsEditingConnection(false); setAccessToken(''); setError(null); }} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-semibold transition-all">Cancelar</button>}
            </div>
          </form>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => <button key={preset.value} onClick={() => selectPreset(preset.value)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${datePreset === preset.value ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'}`}>{preset.label}</button>)}
            </div>
            {overview ? <p className="text-xs text-slate-500 flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5" /> Última atualização: {dateTime(overview.lastUpdatedAt)}</p> : <p className="text-xs text-slate-500">Escolha um período e clique em “Atualizar métricas”.</p>}
          </div>

          {overview && summary && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard label="Investimento" value={money(summary.spend, currency)} detail={`${overview.dateStart || '—'} a ${overview.dateStop || '—'}`} icon={<CircleDollarSign className="w-4 h-4" />} tone="emerald" />
                <MetricCard label="Conversas iniciadas" value={number(summary.messagingConversations)} detail="Resultado atribuído pela Meta a anúncios de mensagem" icon={<MessageCircle className="w-4 h-4" />} tone="blue" />
                <MetricCard label="Custo por conversa" value={money(summary.costPerMessagingConversation, currency)} detail="Investimento dividido por conversas iniciadas" icon={<TrendingUp className="w-4 h-4" />} tone="amber" />
                <MetricCard label="CTR (todos os cliques)" value={percentage(summary.ctr)} detail={`${number(summary.clicks)} cliques em ${number(summary.impressions)} impressões`} icon={<Eye className="w-4 h-4" />} tone="purple" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <h3 className="text-base font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-400" /> Visão por campanha</h3>
                  <p className="mt-1 text-xs text-slate-400">Comparativo real de investimento, conversas e custo por conversa no período selecionado.</p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[650px]">
                      <thead><tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wide"><th className="pb-3 pr-3">Campanha</th><th className="pb-3 pr-3">Status</th><th className="pb-3 text-right">Investimento</th><th className="pb-3 text-right">Conversas</th><th className="pb-3 text-right">Custo/conversa</th><th className="pb-3 text-right">CTR</th></tr></thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {overview.campaigns.map((campaign) => <tr key={campaign.id} className="hover:bg-slate-800/40"><td className="py-3 pr-3"><p className="font-semibold text-slate-100">{campaign.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{campaign.activeAdsCount} ativos · {campaign.adsCount} anúncio(s)</p></td><td className="py-3 pr-3"><StatusBadge status={campaign.deliveryStatus} /></td><td className="py-3 text-right font-medium text-slate-200">{money(campaign.spend, currency)}</td><td className="py-3 text-right text-slate-200">{number(campaign.messagingConversations)}</td><td className="py-3 text-right font-semibold text-emerald-300">{money(campaign.costPerMessagingConversation, currency)}</td><td className="py-3 text-right text-slate-300">{percentage(campaign.ctr)}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
                <aside className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h3 className="text-base font-bold text-white flex items-center gap-2"><Users className="w-5 h-5 text-blue-400" /> Situação dos anúncios</h3>
                  <StatusLine label="Ativos" value={summary.activeAdsCount} status="active" />
                  <StatusLine label="Em análise" value={summary.pendingReviewAdsCount} status="pending_review" />
                  <StatusLine label="Reprovados" value={summary.disapprovedAdsCount} status="disapproved" />
                  <div className="pt-3 border-t border-slate-800 text-xs text-slate-400 leading-relaxed">O status vem da situação efetiva na Meta. “Em análise” e “Reprovado” são destacados para você agir antes de desperdiçar tempo de campanha.</div>
                </aside>
              </div>

              {(overview.warnings.length > 0 || summary.pendingReviewAdsCount > 0 || summary.disapprovedAdsCount > 0) && (
                <section className="bg-amber-950/25 border border-amber-500/30 rounded-2xl p-5">
                  <h3 className="font-bold text-amber-200 flex items-center gap-2"><AlertCircle className="w-5 h-5" /> Alertas de tráfego</h3>
                  <div className="mt-3 space-y-2 text-sm text-amber-100/90">
                    {summary.pendingReviewAdsCount > 0 && <p>Há <strong>{summary.pendingReviewAdsCount}</strong> anúncio(s) em análise; os resultados podem mudar após a aprovação.</p>}
                    {summary.disapprovedAdsCount > 0 && <p>Há <strong>{summary.disapprovedAdsCount}</strong> anúncio(s) reprovado(s); revise o diagnóstico de entrega antes de mexer no orçamento.</p>}
                    {overview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                </section>
              )}

              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div><h3 className="text-base font-bold text-white flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-400" /> Comparativo de criativos</h3><p className="mt-1 text-xs text-slate-400">Compare os anúncios pela eficiência de gerar conversas — não apenas por cliques.</p></div>
                  <span className="text-[11px] text-slate-500">Conta conectada: {overview.accountId}</span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[940px]">
                    <thead><tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wide"><th className="pb-3 pr-3">Criativo / anúncio</th><th className="pb-3 pr-3">Campanha</th><th className="pb-3 pr-3">Situação</th><th className="pb-3 text-right">Investimento</th><th className="pb-3 text-right">Conversas</th><th className="pb-3 text-right">Custo/conversa</th><th className="pb-3 text-right">CTR</th><th className="pb-3 pl-4">Qualidade Meta</th></tr></thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {overview.ads.map((ad) => <tr key={ad.id} className="hover:bg-slate-800/40"><td className="py-3 pr-3"><p className="font-semibold text-slate-100">{ad.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{ad.adSetName}</p></td><td className="py-3 pr-3 text-slate-300">{ad.campaignName}</td><td className="py-3 pr-3"><StatusBadge status={ad.deliveryStatus} /></td><td className="py-3 text-right text-slate-200">{money(ad.spend, currency)}</td><td className="py-3 text-right text-slate-200">{number(ad.messagingConversations)}</td><td className="py-3 text-right font-semibold text-emerald-300">{money(ad.costPerMessagingConversation, currency)}</td><td className="py-3 text-right text-slate-300">{percentage(ad.ctr)}</td><td className="py-3 pl-4"><p className="text-slate-300">Qualidade: {ranking(ad.qualityRanking)}</p><p className="mt-0.5 text-[10px] text-slate-500">Engajamento: {ranking(ad.engagementRateRanking)}</p></td></tr>)}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {!overview && !isRefreshing && (
            <section className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
              <BarChart3 className="w-10 h-10 mx-auto text-slate-600" />
              <h3 className="mt-3 text-base font-bold text-slate-200">Pronto para consultar as campanhas</h3>
              <p className="mt-1 text-sm text-slate-500">Clique em “Atualizar métricas” para carregar os dados do período escolhido. Nenhuma atualização ocorre sozinha.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: DeliveryStatus }> = ({ status }) => {
  const presentation = statusPresentation[status];
  return <span className={`inline-flex px-2.5 py-1 rounded-lg border text-[10px] font-bold ${presentation.className}`}>{presentation.label}</span>;
};

const StatusLine: React.FC<{ label: string; value: number; status: DeliveryStatus }> = ({ label, value, status }) => {
  const presentation = statusPresentation[status];
  return <div className="flex items-center justify-between"><span className="text-sm text-slate-300">{label}</span><span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${presentation.className}`}>{value}</span></div>;
};
