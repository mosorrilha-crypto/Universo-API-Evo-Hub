import { getDb } from './db';

const META_GRAPH_VERSION = 'v26.0';

export const TRAFFIC_DATE_PRESETS = ['today', 'last_7d', 'last_14d', 'last_30d'] as const;
export type TrafficDatePreset = typeof TRAFFIC_DATE_PRESETS[number];

export interface MetaAdsConnectionStatus {
  adAccountId: string | null;
  accessTokenSet: boolean;
  configured: boolean;
  managementTokenSet: boolean;
  managementConfigured: boolean;
}

export interface MetaTrafficAd {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string;
  adSetId: string | null;
  adSetName: string;
  effectiveStatus: string;
  configuredStatus: string | null;
  deliveryStatus: 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  cpm: number | null;
  frequency: number | null;
  outboundClicks: number;
  landingPageViews: number;
  videoThruPlays: number;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
}

export interface MetaTrafficCampaign {
  id: string;
  name: string;
  effectiveStatus: string;
  configuredStatus: string | null;
  deliveryStatus: MetaTrafficAd['deliveryStatus'];
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  cpm: number | null;
  frequency: number | null;
  outboundClicks: number;
  landingPageViews: number;
  videoThruPlays: number;
  adsCount: number;
  activeAdsCount: number;
  pendingReviewAdsCount: number;
  disapprovedAdsCount: number;
}

export interface MetaTrafficOverview {
  datePreset: TrafficDatePreset;
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
    cpm: number | null;
    frequency: number | null;
    outboundClicks: number;
    landingPageViews: number;
    videoThruPlays: number;
    activeAdsCount: number;
    pendingReviewAdsCount: number;
    disapprovedAdsCount: number;
  };
  campaigns: MetaTrafficCampaign[];
  ads: MetaTrafficAd[];
  warnings: string[];
  accountSummary: {
    balanceDue: number | null;
    amountSpent: number | null;
    spendCap: number | null;
    availableSpendCap: number | null;
    currency: string;
    accountStatus: string | null;
  };
}

interface MetaAdsCredentials {
  adAccountId: string;
  accessToken: string;
}

interface GraphActionStat {
  action_type?: string;
  value?: string | number;
}

interface GraphInsightRow {
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  ctr?: string | number;
  cpc?: string | number;
  cpm?: string | number;
  frequency?: string | number;
  outbound_clicks?: string | number;
  landing_page_views?: string | number;
  video_thruplay_watched_actions?: string | number;
  actions?: GraphActionStat[];
  cost_per_action_type?: GraphActionStat[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  date_start?: string;
  date_stop?: string;
}

interface GraphAdRow {
  id?: string;
  name?: string;
  campaign_id?: string;
  adset_id?: string;
  effective_status?: string;
  configured_status?: string;
}

interface GraphCampaignRow {
  id?: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
}

interface GraphAccountRow {
  balance?: string | number;
  amount_spent?: string | number;
  spend_cap?: string | number;
  currency?: string;
  account_status?: string | number;
}

export class MetaAdsConfigurationError extends Error {}
export class MetaAdsRequestError extends Error {}
/** A Meta retorna o código 190 quando o token foi revogado, expirou ou ficou inválido. */
export class MetaAdsTokenExpiredError extends MetaAdsRequestError {}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateAvailableSpendCap(spendCap: number | null, amountSpent: number | null): number | null {
  if (spendCap === null || amountSpent === null) return null;
  return Math.max(0, spendCap - amountSpent);
}

function validAdAccountId(value: string): string {
  const normalized = value.trim();
  if (!/^act_\d+$/.test(normalized)) {
    throw new MetaAdsConfigurationError('A conta de anúncios deve ser informada no formato act_ seguido do ID numérico.');
  }
  return normalized;
}

function deliveryStatusFromMeta(status?: string | null): MetaTrafficAd['deliveryStatus'] {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') return 'active';
  if (normalized === 'PENDING_REVIEW' || normalized === 'IN_PROCESS' || normalized === 'WITH_ISSUES') return 'pending_review';
  if (normalized === 'DISAPPROVED' || normalized === 'REJECTED') return 'disapproved';
  if (normalized === 'PAUSED') return 'paused';
  if (normalized) return 'inactive';
  return 'unknown';
}

const MESSAGING_ACTION_PRIORITY = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.messaging_conversation_started',
  'messaging_conversation_started_7d',
  'messaging_first_reply',
];

function actionTypeForMessagingConversation(stats?: GraphActionStat[]): string | null {
  if (!Array.isArray(stats)) return null;
  for (const actionType of MESSAGING_ACTION_PRIORITY) {
    if (stats.some((item) => item.action_type === actionType)) return actionType;
  }
  return stats.find((item) => String(item.action_type || '').includes('messaging_conversation_started'))?.action_type || null;
}

/** Extrai uma única métrica de conversa iniciada para não somar ações Meta semelhantes em duplicidade. */
export function extractMessagingConversations(stats?: GraphActionStat[]): { actionType: string | null; value: number } {
  const actionType = actionTypeForMessagingConversation(stats);
  if (!actionType || !Array.isArray(stats)) return { actionType: null, value: 0 };
  const record = stats.find((item) => item.action_type === actionType);
  return { actionType, value: numberOrZero(record?.value) };
}

function extractMessagingConversationCost(stats: GraphActionStat[] | undefined, actionType: string | null): number | null {
  if (!actionType || !Array.isArray(stats)) return null;
  return nullableNumber(stats.find((item) => item.action_type === actionType)?.value);
}

export function extractActionValue(stats: GraphActionStat[] | undefined, names: string[]): number {
  if (!Array.isArray(stats)) return 0;
  const match = stats.find((item) => names.includes(String(item.action_type || '')));
  return numberOrZero(match?.value);
}

export function isMetaAccessTokenExpired(payload: any): boolean {
  const code = Number(payload?.error?.code);
  const subcode = Number(payload?.error?.error_subcode);
  const message = String(payload?.error?.message || '');
  return code === 190 && (subcode === 463 || /session has expired|access token.*expired|token.*expired/i.test(message));
}

function safeMetaMessage(payload: any, status: number): string {
  const message = payload?.error?.error_user_msg || payload?.error?.message;
  const code = Number(payload?.error?.code);
  // O token da CAPI pode enviar conversões, mas não necessariamente possui
  // ads_read. Traduzir o erro #200 evita mostrar um detalhe técnico inútil no
  // painel e aponta a ação segura: salvar um token dedicado de leitura.
  if (code === 200 || /ads_management|ads_read/i.test(String(message || ''))) {
    return 'O token atual consegue enviar eventos pela CAPI, mas não tem permissão para ler campanhas. Em “Configurar acesso”, salve um token da Marketing API com a permissão ads_read.';
  }
  if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
  return `A Meta não concluiu a consulta de métricas (HTTP ${status}).`;
}

async function graphGet<T>(path: string, params: Record<string, string>, accessToken: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new MetaAdsRequestError('Não foi possível conectar à Meta para buscar as métricas. Tente atualizar novamente em alguns instantes.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (isMetaAccessTokenExpired(payload)) {
      throw new MetaAdsTokenExpiredError('O acesso da Meta expirou. Gere um novo token com a permissão ads_read e salve-o para voltar a atualizar as métricas.');
    }
    throw new MetaAdsRequestError(safeMetaMessage(payload, response.status));
  }
  return payload as T;
}

async function getTenantMetaAdsCredentials(tenantId: string): Promise<MetaAdsCredentials | null> {
  const database = getDb();
  const { data, error } = await database
    .from('tenant_meta_credentials')
    .select('meta_ads_account_id, meta_ads_access_token, capi_access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Não foi possível ler a configuração Meta Ads: ${error.message}`);
  if (!data?.meta_ads_account_id) return null;

  const accessToken = data.meta_ads_access_token || data.capi_access_token;
  if (!accessToken) return null;
  return { adAccountId: validAdAccountId(data.meta_ads_account_id), accessToken };
}

/** Retorna somente o estado da conexão: o token nunca sai do servidor. */
export async function getMetaAdsConnectionStatus(tenantId: string): Promise<MetaAdsConnectionStatus> {
  const database = getDb();
  const { data, error } = await database
    .from('tenant_meta_credentials')
    .select('meta_ads_account_id, meta_ads_access_token, meta_ads_management_access_token, capi_access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível ler a configuração Meta Ads: ${error.message}`);

  const adAccountId = typeof data?.meta_ads_account_id === 'string' && data.meta_ads_account_id.trim()
    ? data.meta_ads_account_id.trim()
    : null;
  const accessTokenSet = Boolean(data?.meta_ads_access_token || data?.capi_access_token);
  const managementTokenSet = Boolean(data?.meta_ads_management_access_token);
  return {
    adAccountId,
    accessTokenSet,
    configured: Boolean(adAccountId && accessTokenSet),
    managementTokenSet,
    managementConfigured: Boolean(adAccountId && managementTokenSet),
  };
}

/** Salva a autorização exclusivamente no banco do tenant e preserva um token já configurado quando o campo vem vazio. */
export async function saveMetaAdsConnection(
  tenantId: string,
  input: { adAccountId: string; accessToken?: string | null; managementAccessToken?: string | null }
): Promise<MetaAdsConnectionStatus> {
  const database = getDb();
  const adAccountId = validAdAccountId(input.adAccountId);
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  const managementAccessToken = typeof input.managementAccessToken === 'string' ? input.managementAccessToken.trim() : '';

  const { data: existing, error: readError } = await database
    .from('tenant_meta_credentials')
    .select('meta_ads_access_token, meta_ads_management_access_token, capi_access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readError) throw new Error(`Não foi possível validar a configuração Meta Ads: ${readError.message}`);
  if (!accessToken && !managementAccessToken && !existing?.meta_ads_access_token && !existing?.meta_ads_management_access_token && !existing?.capi_access_token) {
    throw new MetaAdsConfigurationError('Informe ao menos um token da Marketing API na primeira configuração.');
  }

  const update: Record<string, string> = { tenant_id: tenantId, meta_ads_account_id: adAccountId };
  if (accessToken) update.meta_ads_access_token = accessToken;
  if (managementAccessToken) update.meta_ads_management_access_token = managementAccessToken;

  const { error } = await database
    .from('tenant_meta_credentials')
    .upsert(update, { onConflict: 'tenant_id' });
  if (error) throw new Error(`Não foi possível salvar a configuração Meta Ads: ${error.message}`);

  return getMetaAdsConnectionStatus(tenantId);
}

function toTrafficAd(insight: GraphInsightRow | undefined, ad: GraphAdRow | undefined): MetaTrafficAd {
  const messaging = extractMessagingConversations(insight?.actions);
  const spend = numberOrZero(insight?.spend);
  const impressions = numberOrZero(insight?.impressions);
  const clicks = numberOrZero(insight?.clicks);
  const costFromMeta = extractMessagingConversationCost(insight?.cost_per_action_type, messaging.actionType);
  const effectiveStatus = ad?.effective_status || 'UNKNOWN';

  return {
    id: insight?.ad_id || ad?.id || '',
    name: insight?.ad_name || ad?.name || 'Anúncio sem nome',
    campaignId: insight?.campaign_id || ad?.campaign_id || null,
    campaignName: insight?.campaign_name || 'Campanha não identificada',
    adSetId: insight?.adset_id || ad?.adset_id || null,
    adSetName: insight?.adset_name || 'Conjunto não identificado',
    effectiveStatus,
    configuredStatus: ad?.configured_status || null,
    deliveryStatus: deliveryStatusFromMeta(effectiveStatus),
    spend,
    impressions,
    reach: numberOrZero(insight?.reach),
    clicks,
    ctr: nullableNumber(insight?.ctr) ?? (impressions > 0 ? (clicks / impressions) * 100 : null),
    cpc: nullableNumber(insight?.cpc) ?? (clicks > 0 ? spend / clicks : null),
    messagingConversations: messaging.value,
    costPerMessagingConversation: costFromMeta ?? (messaging.value > 0 ? spend / messaging.value : null),
    cpm: nullableNumber(insight?.cpm) ?? (impressions > 0 ? (spend / impressions) * 1000 : null),
    frequency: nullableNumber(insight?.frequency),
    outboundClicks: numberOrZero(insight?.outbound_clicks) || extractActionValue(insight?.actions, ['outbound_click', 'outbound_clicks', 'link_click']),
    landingPageViews: extractActionValue(insight?.actions, ['landing_page_view']),
    videoThruPlays: numberOrZero(insight?.video_thruplay_watched_actions) || extractActionValue(insight?.actions, ['video_view']),
    qualityRanking: insight?.quality_ranking || null,
    engagementRateRanking: insight?.engagement_rate_ranking || null,
    conversionRateRanking: insight?.conversion_rate_ranking || null,
  };
}

/** Consulta em tempo real a conta Meta Ads já autorizada e retorna somente métricas processadas para o painel. */
export async function getMetaTrafficOverview(tenantId: string, datePreset: TrafficDatePreset): Promise<MetaTrafficOverview> {
  const credentials = await getTenantMetaAdsCredentials(tenantId);
  if (!credentials) {
    throw new MetaAdsConfigurationError('A Central de Tráfego ainda não está conectada à conta Meta Ads deste negócio.');
  }

  const queryBase = { limit: '250' };
  const [insightsResponse, adsResponse, campaignsResponse, accountResponse] = await Promise.all([
    graphGet<{ data?: GraphInsightRow[] }>(
      `${credentials.adAccountId}/insights`,
      {
        ...queryBase,
        level: 'ad',
        date_preset: datePreset,
        use_account_attribution_setting: 'true',
        fields: [
          'account_currency', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
          'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency', 'video_thruplay_watched_actions', 'actions', 'cost_per_action_type',
          'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking', 'date_start', 'date_stop',
        ].join(','),
      },
      credentials.accessToken
    ),
    graphGet<{ data?: GraphAdRow[] }>(
      `${credentials.adAccountId}/ads`,
      { ...queryBase, fields: 'id,name,campaign_id,adset_id,effective_status,configured_status' },
      credentials.accessToken
    ),
    graphGet<{ data?: GraphCampaignRow[] }>(
      `${credentials.adAccountId}/campaigns`,
      { ...queryBase, fields: 'id,name,effective_status,configured_status' },
      credentials.accessToken
    ),
    graphGet<GraphAccountRow>(
      credentials.adAccountId,
      { fields: 'balance,amount_spent,spend_cap,currency,account_status' },
      credentials.accessToken
    ).catch(() => ({} as GraphAccountRow)),
  ]);

  const insights = insightsResponse.data || [];
  const ads = adsResponse.data || [];
  const campaignsById = new Map((campaignsResponse.data || []).filter((item) => item.id).map((item) => [item.id as string, item]));
  const adsById = new Map(ads.filter((item) => item.id).map((item) => [item.id as string, item]));
  const seenAdIds = new Set<string>();

  const trafficAds: MetaTrafficAd[] = insights
    .filter((insight) => Boolean(insight.ad_id))
    .map((insight) => {
      seenAdIds.add(insight.ad_id as string);
      return toTrafficAd(insight, adsById.get(insight.ad_id as string));
    });

  // Mantém visíveis anúncios ativos, pausados ou em análise mesmo quando ainda não têm entrega no período selecionado.
  for (const ad of ads) {
    if (ad.id && !seenAdIds.has(ad.id)) trafficAds.push(toTrafficAd(undefined, ad));
  }

  const campaignMap = new Map<string, MetaTrafficCampaign>();
  for (const ad of trafficAds) {
    const id = ad.campaignId || 'unknown';
    const source = ad.campaignId ? campaignsById.get(ad.campaignId) : undefined;
    const current = campaignMap.get(id) || {
      id,
      name: source?.name || ad.campaignName,
      effectiveStatus: source?.effective_status || 'UNKNOWN',
      configuredStatus: source?.configured_status || null,
      deliveryStatus: deliveryStatusFromMeta(source?.effective_status),
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      ctr: null,
      messagingConversations: 0,
      costPerMessagingConversation: null,
      cpm: null,
      frequency: null,
      outboundClicks: 0,
      landingPageViews: 0,
      videoThruPlays: 0,
      adsCount: 0,
      activeAdsCount: 0,
      pendingReviewAdsCount: 0,
      disapprovedAdsCount: 0,
    };
    current.spend += ad.spend;
    current.impressions += ad.impressions;
    current.reach += ad.reach;
    current.clicks += ad.clicks;
    current.messagingConversations += ad.messagingConversations;
    current.outboundClicks += ad.outboundClicks;
    current.landingPageViews += ad.landingPageViews;
    current.videoThruPlays += ad.videoThruPlays;
    current.adsCount += 1;
    if (ad.deliveryStatus === 'active') current.activeAdsCount += 1;
    if (ad.deliveryStatus === 'pending_review') current.pendingReviewAdsCount += 1;
    if (ad.deliveryStatus === 'disapproved') current.disapprovedAdsCount += 1;
    current.ctr = current.impressions > 0 ? (current.clicks / current.impressions) * 100 : null;
    current.costPerMessagingConversation = current.messagingConversations > 0
      ? current.spend / current.messagingConversations
      : null;
    campaignMap.set(id, current);
  }

  const summary = trafficAds.reduce<MetaTrafficOverview['summary']>((total, ad) => {
    total.spend += ad.spend;
    total.impressions += ad.impressions;
    total.reach += ad.reach;
    total.clicks += ad.clicks;
    total.messagingConversations += ad.messagingConversations;
    total.outboundClicks += ad.outboundClicks;
    total.landingPageViews += ad.landingPageViews;
    total.videoThruPlays += ad.videoThruPlays;
    if (ad.deliveryStatus === 'active') total.activeAdsCount += 1;
    if (ad.deliveryStatus === 'pending_review') total.pendingReviewAdsCount += 1;
    if (ad.deliveryStatus === 'disapproved') total.disapprovedAdsCount += 1;
    return total;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: null,
    cpc: null,
    messagingConversations: 0,
    costPerMessagingConversation: null,
    cpm: null,
    frequency: null,
    outboundClicks: 0,
    landingPageViews: 0,
    videoThruPlays: 0,
    activeAdsCount: 0,
    pendingReviewAdsCount: 0,
    disapprovedAdsCount: 0,
  });
  summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : null;
  summary.cpc = summary.clicks > 0 ? summary.spend / summary.clicks : null;
  summary.cpm = summary.impressions > 0 ? (summary.spend / summary.impressions) * 1000 : null;
  summary.costPerMessagingConversation = summary.messagingConversations > 0
    ? summary.spend / summary.messagingConversations
    : null;

  const firstInsight = insights[0];
  const accountBalance = nullableNumber(accountResponse.balance);
  const accountAmountSpent = nullableNumber(accountResponse.amount_spent);
  const accountSpendCap = nullableNumber(accountResponse.spend_cap);
  const availableSpendCap = calculateAvailableSpendCap(accountSpendCap, accountAmountSpent);
  const accountSummary = {
    balanceDue: accountBalance,
    amountSpent: accountAmountSpent,
    spendCap: accountSpendCap,
    availableSpendCap,
    currency: accountResponse.currency || firstInsight?.account_currency || 'BRL',
    accountStatus: accountResponse.account_status === undefined ? null : String(accountResponse.account_status),
  };

  const warnings: string[] = [];
  if (summary.spend > 0 && summary.messagingConversations === 0) {
    warnings.push('A Meta não retornou conversas iniciadas neste período. Verifique se o objetivo e a métrica de resultado da campanha estão configurados para mensagens.');
  }
  if (trafficAds.length > 0 && trafficAds.every((ad) => !ad.qualityRanking && !ad.engagementRateRanking && !ad.conversionRateRanking)) {
    warnings.push('Os rankings de qualidade ainda não estão disponíveis para estes anúncios ou não atingiram volume suficiente.');
  }

  return {
    datePreset,
    dateStart: firstInsight?.date_start || null,
    dateStop: firstInsight?.date_stop || null,
    accountId: credentials.adAccountId,
    currency: firstInsight?.account_currency || 'BRL',
    lastUpdatedAt: new Date().toISOString(),
    summary,
    campaigns: [...campaignMap.values()].sort((a, b) => b.spend - a.spend),
    ads: trafficAds.sort((a, b) => b.spend - a.spend),
    warnings,
    accountSummary,
  };
}

export function isTrafficDatePreset(value: unknown): value is TrafficDatePreset {
  return typeof value === 'string' && (TRAFFIC_DATE_PRESETS as readonly string[]).includes(value);
}

export function trafficDeliveryLabel(status: MetaTrafficAd['deliveryStatus']): string {
  const labels: Record<MetaTrafficAd['deliveryStatus'], string> = {
    active: 'Ativo',
    paused: 'Pausado',
    pending_review: 'Em análise',
    disapproved: 'Reprovado',
    inactive: 'Inativo',
    unknown: 'Sem status',
  };
  return labels[status];
}
