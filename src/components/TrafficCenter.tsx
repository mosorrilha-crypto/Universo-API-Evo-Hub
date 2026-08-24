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
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import { CreativeComparisonPanel } from './CreativeComparisonPanel';
import { MetaAdsManagementPanel } from './MetaAdsManagementPanel';

type DatePreset = 'today' | 'last_7d' | 'last_14d' | 'last_30d';
type DeliveryStatus = 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';

interface MetaAdsConnection {
  adAccountId: string | null;
  accessTokenSet: boolean;
  configured: boolean;
  managementTokenSet: boolean;
  managementConfigured: boolean;
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

type TrafficCopy = {
  presets: Record<DatePreset, string>;
  status: Record<DeliveryStatus, string>;
  rankUnavailable: string;
  rankings: Record<string, string>;
  verifyConnection: string;
  connectionError: string;
  metricError: string;
  metricsUpdated: string;
  saveError: string;
  connectionSaved: string;
  title: string;
  description: string;
  refresh: string;
  refreshing: string;
  configureAccess: string;
  generateReadToken: string;
  updateReadAccess: string;
  connectReadAccess: string;
  accessDescription: string;
  adAccount: string;
  readToken: string;
  permissionNote: string;
  savingConnection: string;
  saveConnection: string;
  cancel: string;
  lastUpdated: string;
  choosePeriod: string;
  investment: string;
  conversationsStarted: string;
  conversationAttributed: string;
  costPerConversation: string;
  investmentPerConversation: string;
  allClicksCtr: string;
  clicksImpressions: (clicks: string, impressions: string) => string;
  campaignView: string;
  campaignViewDescription: string;
  campaign: string;
  statusLabel: string;
  conversations: string;
  activeAds: (active: number, total: number) => string;
  adSituation: string;
  active: string;
  pendingReview: string;
  disapproved: string;
  statusExplanation: string;
  trafficAlerts: string;
  pendingAlert: (count: number) => string;
  disapprovedAlert: (count: number) => string;
  creativeComparison: string;
  creativeDescription: string;
  connectedAccount: string;
  creativeAd: string;
  quality: string;
  engagement: string;
  ready: string;
  readyDescription: string;
  managementToken: string;
  managementPermissionNote: string;
  generateManagementToken: string;
  generateSystemUserToken: string;
  debugToken: string;
};

const trafficCopy: Record<'pt' | 'es', TrafficCopy> = {
  pt: {
    presets: { today: 'Hoje', last_7d: '7 dias', last_14d: '14 dias', last_30d: '30 dias' },
    status: { active: 'Ativo', paused: 'Pausado', pending_review: 'Em análise', disapproved: 'Reprovado', inactive: 'Inativo', unknown: 'Sem status' },
    rankUnavailable: 'Não disponível',
    rankings: { ABOVE_AVERAGE: 'Acima da média', AVERAGE: 'Na média', BELOW_AVERAGE_10: 'Abaixo da média (10%)', BELOW_AVERAGE_20: 'Abaixo da média (20%)', BELOW_AVERAGE_35: 'Abaixo da média (35%)' },
    verifyConnection: 'Verificando a conexão segura com a conta Meta Ads…', connectionError: 'Não foi possível verificar a conexão com Meta Ads.', metricError: 'Não foi possível atualizar as métricas.', metricsUpdated: 'Métricas atualizadas com dados reais da Meta.', saveError: 'Não foi possível salvar a conexão Meta Ads.', connectionSaved: 'Conexão protegida salva. Agora você pode atualizar as métricas.',
    title: 'Central de Tráfego', description: 'Acompanhe as campanhas de WhatsApp sem abrir o Gerenciador: investimento, conversas iniciadas, custo por conversa, criativos e situação de entrega. A atualização é manual e sempre informa quando os dados foram consultados.', refresh: 'Atualizar métricas', refreshing: 'Atualizando dados reais…', configureAccess: 'Configurar acesso', generateReadToken: 'Gerar token de leitura na Meta', updateReadAccess: 'Atualizar acesso de leitura', connectReadAccess: 'Conectar a leitura de campanhas', accessDescription: 'Informe a conta de anúncios e um token da Marketing API com permissão de leitura de anúncios. O token é salvo apenas no servidor, nunca aparece novamente no painel e não será usado para criar, pausar ou editar campanhas.', adAccount: 'Conta de anúncios', readToken: 'Token da Marketing API com permissão de leitura', permissionNote: 'A permissão necessária é ads_read. Se o mesmo token da CAPI já tiver essa permissão, ele pode ser reutilizado.', savingConnection: 'Salvando conexão…', saveConnection: 'Salvar conexão protegida', cancel: 'Cancelar', lastUpdated: 'Última atualização:', choosePeriod: 'Escolha um período e clique em “Atualizar métricas”.', investment: 'Investimento', conversationsStarted: 'Conversas iniciadas', conversationAttributed: 'Resultado atribuído pela Meta a anúncios de mensagem', costPerConversation: 'Custo por conversa', investmentPerConversation: 'Investimento dividido por conversas iniciadas', allClicksCtr: 'CTR (todos os cliques)', clicksImpressions: (clicks, impressions) => `${clicks} cliques em ${impressions} impressões`, campaignView: 'Visão por campanha', campaignViewDescription: 'Comparativo real de investimento, conversas e custo por conversa no período selecionado.', campaign: 'Campanha', statusLabel: 'Status', conversations: 'Conversas', activeAds: (active, total) => `${active} ativos · ${total} anúncio(s)`, adSituation: 'Situação dos anúncios', active: 'Ativos', pendingReview: 'Em análise', disapproved: 'Reprovados', statusExplanation: 'O status vem da situação efetiva na Meta. “Em análise” e “Reprovado” são destacados para você agir antes de desperdiçar tempo de campanha.', trafficAlerts: 'Alertas de tráfego', pendingAlert: (count) => `Há ${count} anúncio(s) em análise; os resultados podem mudar após a aprovação.`, disapprovedAlert: (count) => `Há ${count} anúncio(s) reprovado(s); revise o diagnóstico de entrega antes de mexer no orçamento.`, creativeComparison: 'Comparativo de criativos', creativeDescription: 'Compare os anúncios pela eficiência de gerar conversas — não apenas por cliques.', connectedAccount: 'Conta conectada:', creativeAd: 'Criativo / anúncio', quality: 'Qualidade', engagement: 'Engajamento', ready: 'Pronto para consultar as campanhas', readyDescription: 'Clique em “Atualizar métricas” para carregar os dados do período escolhido. Nenhuma atualização ocorre sozinha.', managementToken: 'Token da Marketing API para gerenciamento', managementPermissionNote: 'Para escrita, use um token com ads_management. Para Click to WhatsApp, a Meta também documenta pages_manage_ads, pages_read_engagement e pages_show_list. Deixe em branco para manter o token já salvo.', generateManagementToken: 'Gerar token de gerenciamento na Meta', generateSystemUserToken: 'Token de usuário do sistema (produção)', debugToken: 'Validar token no Access Token Debugger',
  },
  es: {
    presets: { today: 'Hoy', last_7d: '7 días', last_14d: '14 días', last_30d: '30 días' },
    status: { active: 'Activo', paused: 'Pausado', pending_review: 'En revisión', disapproved: 'Rechazado', inactive: 'Inactivo', unknown: 'Sin estado' },
    rankUnavailable: 'No disponible',
    rankings: { ABOVE_AVERAGE: 'Por encima del promedio', AVERAGE: 'Promedio', BELOW_AVERAGE_10: 'Por debajo del promedio (10%)', BELOW_AVERAGE_20: 'Por debajo del promedio (20%)', BELOW_AVERAGE_35: 'Por debajo del promedio (35%)' },
    verifyConnection: 'Verificando la conexión segura con la cuenta de Meta Ads…', connectionError: 'No fue posible verificar la conexión con Meta Ads.', metricError: 'No fue posible actualizar las métricas.', metricsUpdated: 'Métricas actualizadas con datos reales de Meta.', saveError: 'No fue posible guardar la conexión de Meta Ads.', connectionSaved: 'Conexión protegida guardada. Ya podés actualizar las métricas.',
    title: 'Central de Tráfico', description: 'Acompañá las campañas de WhatsApp sin abrir el Administrador: inversión, conversaciones iniciadas, costo por conversación, creativos y estado de entrega. La actualización es manual y siempre informa cuándo se consultaron los datos.', refresh: 'Actualizar métricas', refreshing: 'Actualizando datos reales…', configureAccess: 'Configurar acceso', generateReadToken: 'Generar token de lectura en Meta', updateReadAccess: 'Actualizar acceso de lectura', connectReadAccess: 'Conectar la lectura de campañas', accessDescription: 'Ingresá la cuenta publicitaria y un token de Marketing API con permiso para leer anuncios. El token se guarda solo en el servidor, nunca vuelve a mostrarse en el panel y no se usará para crear, pausar ni editar campañas.', adAccount: 'Cuenta publicitaria', readToken: 'Token de Marketing API con permiso de lectura', permissionNote: 'El permiso necesario es ads_read. Si el mismo token de CAPI ya tiene ese permiso, podés reutilizarlo.', savingConnection: 'Guardando conexión…', saveConnection: 'Guardar conexión protegida', cancel: 'Cancelar', lastUpdated: 'Última actualización:', choosePeriod: 'Elegí un período y hacé clic en “Actualizar métricas”.', investment: 'Inversión', conversationsStarted: 'Conversaciones iniciadas', conversationAttributed: 'Resultado atribuido por Meta a anuncios de mensajes', costPerConversation: 'Costo por conversación', investmentPerConversation: 'Inversión dividida por conversaciones iniciadas', allClicksCtr: 'CTR (todos los clics)', clicksImpressions: (clicks, impressions) => `${clicks} clics en ${impressions} impresiones`, campaignView: 'Vista por campaña', campaignViewDescription: 'Comparativo real de inversión, conversaciones y costo por conversación en el período seleccionado.', campaign: 'Campaña', statusLabel: 'Estado', conversations: 'Conversaciones', activeAds: (active, total) => `${active} activos · ${total} anuncio(s)`, adSituation: 'Situación de los anuncios', active: 'Activos', pendingReview: 'En revisión', disapproved: 'Rechazados', statusExplanation: 'El estado proviene de la situación efectiva en Meta. “En revisión” y “Rechazado” se destacan para que actúes antes de desperdiciar tiempo de campaña.', trafficAlerts: 'Alertas de tráfico', pendingAlert: (count) => `Hay ${count} anuncio(s) en revisión; los resultados pueden cambiar tras la aprobación.`, disapprovedAlert: (count) => `Hay ${count} anuncio(s) rechazado(s); revisá el diagnóstico de entrega antes de modificar el presupuesto.`, creativeComparison: 'Comparativo de creativos', creativeDescription: 'Compará los anuncios por su eficiencia al generar conversaciones, no solo por clics.', connectedAccount: 'Cuenta conectada:', creativeAd: 'Creativo / anuncio', quality: 'Calidad', engagement: 'Interacción', ready: 'Listo para consultar las campañas', readyDescription: 'Hacé clic en “Actualizar métricas” para cargar los datos del período elegido. No se realiza ninguna actualización de forma automática.', managementToken: 'Token de Marketing API para gestión', managementPermissionNote: 'Para escritura, usá un token con ads_management. Para Click to WhatsApp, Meta también documenta pages_manage_ads, pages_read_engagement y pages_show_list. Dejá vacío para mantener el token guardado.', generateManagementToken: 'Generar token de gestión en Meta', generateSystemUserToken: 'Token de usuario del sistema (producción)', debugToken: 'Validar token en Access Token Debugger',
  },
};

function money(value: number | null | undefined, currency: string, locale: string): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function number(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function percentage(value: number | null | undefined, locale: string): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
}

const MetricCard: React.FC<{ label: string; value: string; detail: string; icon: React.ReactNode; tone?: 'emerald' | 'blue' | 'amber' | 'sky' }> = ({ label, value, detail, icon, tone = 'emerald' }) => {
  const tones = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  };
  return <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-400">{label}</span><span className={`p-2 rounded-xl border ${tones[tone]}`}>{icon}</span></div><p className="mt-4 text-2xl font-bold text-white tracking-tight">{value}</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p></div>;
};

export const TrafficCenter: React.FC = () => {
  const { language } = useAppPreferences();
  const copy = trafficCopy[language];
  const locale = language === 'es' ? 'es-PY' : 'pt-BR';
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
  const [managementAccessToken, setManagementAccessToken] = useState('');

  const fetchConnection = async () => {
    setIsLoadingConnection(true);
    try {
      const response = await apiFetch('/api/meta-ads/connection');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || copy.connectionError);
      setConnection(data.connection);
      setAdAccountId(data.connection.adAccountId || '');
    } catch (requestError: any) {
      setError(requestError.message || copy.connectionError);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  useEffect(() => { void fetchConnection(); }, []);

  const refreshMetrics = async (preset = datePreset) => {
    setIsRefreshing(true); setError(null); setNotice(null);
    try {
      const response = await apiFetch(`/api/meta-ads/insights?datePreset=${preset}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || copy.metricError);
      setOverview(data.overview); setNotice(copy.metricsUpdated);
    } catch (requestError: any) {
      setError(requestError.message || copy.metricError);
    } finally { setIsRefreshing(false); }
  };

  const saveConnection = async (event: React.FormEvent) => {
    event.preventDefault(); setIsSaving(true); setError(null); setNotice(null);
    try {
      const response = await apiFetch('/api/meta-ads/connection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adAccountId, ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}), ...(managementAccessToken.trim() ? { managementAccessToken: managementAccessToken.trim() } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || copy.saveError);
      setConnection(data.connection); setAccessToken(''); setManagementAccessToken(''); setIsEditingConnection(false); setNotice(copy.connectionSaved); await refreshMetrics();
    } catch (requestError: any) { setError(requestError.message || copy.saveError); }
    finally { setIsSaving(false); }
  };

  if (isLoadingConnection) return <div className="p-8 text-sm text-slate-400">{copy.verifyConnection}</div>;

  const isConfigured = Boolean(connection?.configured);
  const currency = overview?.currency || 'BRL';
  const summary = overview?.summary;
  const rank = (value: string | null) => !value ? copy.rankUnavailable : copy.rankings[value] || value.replaceAll('_', ' ');
  const statusPresentation: Record<DeliveryStatus, { label: string; className: string }> = {
    active: { label: copy.status.active, className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }, paused: { label: copy.status.paused, className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }, pending_review: { label: copy.status.pending_review, className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }, disapproved: { label: copy.status.disapproved, className: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }, inactive: { label: copy.status.inactive, className: 'bg-slate-700 text-slate-400 border-slate-600' }, unknown: { label: copy.status.unknown, className: 'bg-slate-700 text-slate-400 border-slate-600' },
  };
  const StatusBadge = ({ status }: { status: DeliveryStatus }) => <span className={`inline-flex px-2.5 py-1 rounded-lg border text-[10px] font-bold ${statusPresentation[status].className}`}>{statusPresentation[status].label}</span>;

  return <div className="traffic-workspace space-y-6">
    <section className="traffic-workspace__hero bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden"><div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" /><div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-3xl"><div className="flex items-center gap-3 mb-2"><span className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"><BarChart3 className="w-6 h-6" /></span><h2 className="text-2xl font-bold tracking-tight text-white">{copy.title}</h2></div><p className="text-sm leading-relaxed text-slate-300">{copy.description}</p></div>{isConfigured && <div className="traffic-workspace__actions shrink-0 flex flex-wrap items-center gap-2"><button onClick={() => void refreshMetrics()} disabled={isRefreshing} className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />{isRefreshing ? copy.refreshing : copy.refresh}</button><button onClick={() => { setIsEditingConnection(true); setError(null); setNotice(null); }} className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all"><Settings2 className="w-4 h-4 text-emerald-400" />{copy.configureAccess}</button></div>}</div></section>
    {error && <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-100 text-sm flex gap-3"><AlertCircle className="w-5 h-5 shrink-0 text-rose-300" /><div className="space-y-2"><p>{error}</p>{(error.includes('ads_read') || error.includes('acesso da Meta expirou')) && <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="inline-flex font-semibold text-rose-200 underline decoration-rose-300/70 underline-offset-4 hover:text-white">{copy.generateReadToken}</a>}</div></div>}
    {notice && <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-100 text-sm flex gap-3"><CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-300" /><p>{notice}</p></div>}
    {(!isConfigured || isEditingConnection) ? <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-3xl space-y-5"><div className="flex gap-3"><span className="p-2.5 h-fit rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300"><Settings2 className="w-5 h-5" /></span><div><h3 className="text-lg font-bold text-white">{isConfigured ? copy.updateReadAccess : copy.connectReadAccess}</h3><p className="mt-1 text-sm leading-relaxed text-slate-400">{copy.accessDescription}</p></div></div><form onSubmit={saveConnection} className="space-y-4"><div><label className="block mb-1.5 text-xs font-semibold text-slate-300">{copy.adAccount}</label><input value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} placeholder="act_677275869339059" required className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500" /></div><div><label className="block mb-1.5 text-xs font-semibold text-slate-300">{copy.readToken}</label><input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="EAAG…" required={!connection?.accessTokenSet && !connection?.managementTokenSet} autoComplete="new-password" className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500" /><p className="mt-1.5 text-[11px] text-slate-500">{copy.permissionNote}</p><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-300 underline decoration-emerald-400/70 underline-offset-4 hover:text-emerald-100"><ShieldCheck className="w-3.5 h-3.5" />{copy.generateReadToken}</a></div><div><label className="block mb-1.5 text-xs font-semibold text-slate-300">{copy.managementToken}</label><input type="password" value={managementAccessToken} onChange={(event) => setManagementAccessToken(event.target.value)} placeholder={connection?.managementTokenSet ? 'Já configurado — deixe em branco para manter' : 'Token com ads_management…'} autoComplete="new-password" className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:outline-none focus:border-indigo-500" /><p className="mt-1.5 text-[11px] text-slate-500">{copy.managementPermissionNote}</p><div className="flex flex-wrap gap-x-4 gap-y-2 pt-2"><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-semibold text-indigo-300 underline decoration-indigo-400/70 underline-offset-4 hover:text-indigo-100">{copy.generateManagementToken}</a><a href="https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens" target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-semibold text-indigo-300 underline decoration-indigo-400/70 underline-offset-4 hover:text-indigo-100">{copy.generateSystemUserToken}</a><a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-semibold text-slate-300 underline decoration-slate-400/70 underline-offset-4 hover:text-white">{copy.debugToken}</a></div></div><div className="flex flex-wrap gap-2"><button type="submit" disabled={isSaving} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition-all">{isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}{isSaving ? copy.savingConnection : copy.saveConnection}</button>{isConfigured && <button type="button" onClick={() => { setIsEditingConnection(false); setAccessToken(''); setManagementAccessToken(''); setError(null); }} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-semibold transition-all">{copy.cancel}</button>}</div></form></section> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div className="flex flex-wrap gap-2">{(Object.keys(copy.presets) as DatePreset[]).map((preset) => <button key={preset} onClick={() => { setDatePreset(preset); if (overview) void refreshMetrics(preset); }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${datePreset === preset ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'}`}>{copy.presets[preset]}</button>)}</div>{overview ? <p className="text-xs text-slate-500 flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5" />{copy.lastUpdated} {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(overview.lastUpdatedAt))}</p> : <p className="text-xs text-slate-500">{copy.choosePeriod}</p>}</div>
      {overview && summary && <><div className="traffic-workspace__metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"><MetricCard label={copy.investment} value={money(summary.spend, currency, locale)} detail={`${overview.dateStart || '—'} a ${overview.dateStop || '—'}`} icon={<CircleDollarSign className="w-4 h-4" />} tone="emerald" /><MetricCard label={copy.conversationsStarted} value={number(summary.messagingConversations, locale)} detail={copy.conversationAttributed} icon={<MessageCircle className="w-4 h-4" />} tone="blue" /><MetricCard label={copy.costPerConversation} value={money(summary.costPerMessagingConversation, currency, locale)} detail={copy.investmentPerConversation} icon={<TrendingUp className="w-4 h-4" />} tone="amber" /><MetricCard label={copy.allClicksCtr} value={percentage(summary.ctr, locale)} detail={copy.clicksImpressions(number(summary.clicks, locale), number(summary.impressions, locale))} icon={<Eye className="w-4 h-4" />} tone="sky" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5"><h3 className="text-base font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-400" />{copy.campaignView}</h3><p className="mt-1 text-xs text-slate-400">{copy.campaignViewDescription}</p><div className="responsive-table-scroll mt-4 overflow-x-auto"><table className="w-full text-left text-xs min-w-[650px]"><thead><tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wide"><th className="pb-3 pr-3">{copy.campaign}</th><th className="pb-3 pr-3">{copy.statusLabel}</th><th className="pb-3 text-right">{copy.investment}</th><th className="pb-3 text-right">{copy.conversations}</th><th className="pb-3 text-right">{copy.costPerConversation}</th><th className="pb-3 text-right">CTR</th></tr></thead><tbody className="divide-y divide-slate-800/80">{overview.campaigns.map((campaign) => <tr key={campaign.id} className="hover:bg-slate-800/40"><td className="py-3 pr-3"><p className="font-semibold text-slate-100">{campaign.name}</p><p className="mt-0.5 text-[10px] text-slate-500">{copy.activeAds(campaign.activeAdsCount, campaign.adsCount)}</p></td><td className="py-3 pr-3"><StatusBadge status={campaign.deliveryStatus} /></td><td className="py-3 text-right font-medium text-slate-200">{money(campaign.spend, currency, locale)}</td><td className="py-3 text-right text-slate-200">{number(campaign.messagingConversations, locale)}</td><td className="py-3 text-right font-semibold text-emerald-300">{money(campaign.costPerMessagingConversation, currency, locale)}</td><td className="py-3 text-right text-slate-300">{percentage(campaign.ctr, locale)}</td></tr>)}</tbody></table></div></div><aside className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><h3 className="text-base font-bold text-white flex items-center gap-2"><Users className="w-5 h-5 text-blue-400" />{copy.adSituation}</h3>{[[copy.active, summary.activeAdsCount, 'active'], [copy.pendingReview, summary.pendingReviewAdsCount, 'pending_review'], [copy.disapproved, summary.disapprovedAdsCount, 'disapproved']].map(([label, value, status]) => <div key={String(status)} className="flex items-center justify-between"><span className="text-sm text-slate-300">{label}</span><span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${statusPresentation[status as DeliveryStatus].className}`}>{value}</span></div>)}<div className="pt-3 border-t border-slate-800 text-xs text-slate-400 leading-relaxed">{copy.statusExplanation}</div></aside></div>
      {(overview.warnings.length > 0 || summary.pendingReviewAdsCount > 0 || summary.disapprovedAdsCount > 0) && <section className="bg-amber-950/25 border border-amber-500/30 rounded-2xl p-5"><h3 className="font-bold text-amber-200 flex items-center gap-2"><AlertCircle className="w-5 h-5" />{copy.trafficAlerts}</h3><div className="mt-3 space-y-2 text-sm text-amber-100/90">{summary.pendingReviewAdsCount > 0 && <p>{copy.pendingAlert(summary.pendingReviewAdsCount)}</p>}{summary.disapprovedAdsCount > 0 && <p>{copy.disapprovedAlert(summary.disapprovedAdsCount)}</p>}{overview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>}
      <CreativeComparisonPanel ads={overview.ads} accountId={overview.accountId} currency={currency} locale={locale} language={language} money={money} number={number} percentage={percentage} rank={rank} onNotice={setNotice} /><MetaAdsManagementPanel language={language} managementConfigured={Boolean(connection?.managementConfigured)} campaigns={overview.campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, deliveryStatus: campaign.deliveryStatus }))} currency={currency} onRefresh={() => refreshMetrics()} onNotice={setNotice} onError={setError} /></>}
      {!overview && !isRefreshing && <section className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-10 text-center"><BarChart3 className="w-10 h-10 mx-auto text-slate-600" /><h3 className="mt-3 text-base font-bold text-slate-200">{copy.ready}</h3><p className="mt-1 text-sm text-slate-500">{copy.readyDescription}</p></section>}
    </>}
  </div>;
};
