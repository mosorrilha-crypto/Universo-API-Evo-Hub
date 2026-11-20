/**
 * Uso real de tokens Gemini por tenant — GitHub issue #90. Antes disso,
 * `/api/telemetry/tokens` respondia vazio honestamente, mas nenhuma
 * gravação de `usageMetadata` existia no backend. Ver
 * server/services/autoReply.ts (withGeminiRetry) para os 4 pontos de
 * chamada que gravam aqui.
 */
import { getDb } from './db';
import { getTenantDbContext } from './tenantDbContext';
import { estimateUsageCostUSD, estimateCacheSavingsUSD, isKnownUsageModel } from './modelPricing';

export type GeminiCallSite = 'router' | 'especialista' | 'agendamento' | 'foto' | 'analise' | 'transcricao';

/** Router-fallback Groq (plano aprovado): qual provedor gerou a chamada, pra não misturar custo/volume dos dois na telemetria. Ausente/legado = 'gemini'. */
export type LlmProvider = 'gemini' | 'groq';

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  model?: string;
}

/**
 * Grava uma chamada Gemini ou Groq — fire-and-forget (nunca lança, só loga),
 * chamada sem `await` por quem chama, igual ao padrão já usado em
 * notifyMetaCapiEvent (telemetria nunca pode travar/quebrar o fluxo real do
 * agente). Sem `usage` (resposta sem usageMetadata), não grava nada — nunca
 * inventa um número que a API não devolveu.
 */
export async function recordGeminiUsage(
  tenantId: string,
  callSite: GeminiCallSite,
  usage: GeminiUsageMetadata | undefined,
  provider: LlmProvider = 'gemini'
): Promise<void> {
  if (!usage) return;
  try {
    const db = getDb();
    const { error } = await db.from('gemini_token_usage').insert({
      tenant_id: tenantId,
      call_site: callSite,
      provider,
      prompt_tokens: usage.promptTokenCount || 0,
      candidates_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
      cached_tokens: usage.cachedContentTokenCount || 0,
      model: usage.model || null,
      thinking_tokens: usage.thoughtsTokenCount ?? null,
      // Explícito em vez de confiar no default do Postgres (now()) — a
      // agregação por janela de tempo (getTokenTelemetry) precisa desse
      // valor logo após o insert, sem round-trip extra pra ler de volta.
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    console.warn('⚠️  [Telemetria] falha ao gravar uso de tokens Gemini/Groq (não bloqueia o agente):', (err as Error)?.message || err);
  }
}

/** Recorte de tokens/requisições de um único provedor — ver ProviderTokenBreakdown abaixo. */
export interface ProviderTokenBreakdown {
  tokens: number;
  requests: number;
  costUSD: number;
}

/**
 * Router fallback Groq (plano aprovado): quanto de cada total (por tenant e
 * no agregado do SaaS) veio do Gemini vs. do Groq — sem isso, o painel
 * "Telemetria de Tokens IA" mostraria só o total combinado, sem dar pra
 * comparar quanto cada provedor está de fato sendo usado depois que o Groq
 * entrar em produção. Sempre traz as duas chaves, mesmo zeradas — nunca
 * omite 'groq' só porque um tenant específico não usou ainda.
 */
export interface ProviderBreakdown {
  gemini: ProviderTokenBreakdown;
  groq: ProviderTokenBreakdown;
}

function emptyProviderBreakdown(): ProviderBreakdown {
  return { gemini: { tokens: 0, requests: 0, costUSD: 0 }, groq: { tokens: 0, requests: 0, costUSD: 0 } };
}

export interface TenantTokenSummary {
  tenantId: string;
  tenantName: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  requestCount: number;
  cachedTokensSaved: number;
  estimatedCostUSD: number;
  cacheSavingsUSD: number;
  lastRequestAt: string;
  providerBreakdown: ProviderBreakdown;
}

export interface TokenTelemetrySummary {
  legacyRequests: number;
  unpricedRequests: number;
  totalSaaSTokens: number;
  totalSaaSCostUSD: number;
  totalCachedSaved: number;
  totalCacheSavingsUSD: number;
  totalRequests: number;
  providerBreakdown: ProviderBreakdown;
}

const TELEMETRY_WINDOW_DAYS = 30;

/** Agregado de 30 dias, paginado. Modelo e raciocínio reais quando disponíveis;
 * legado sem modelo permanece aproximação identificada no painel. Não é fatura. */
export async function getTokenTelemetry(): Promise<{ summary: TokenTelemetrySummary; tenantsTelemetry: TenantTokenSummary[] }> {
  const db = getDb();
  const until = new Date().toISOString();
  const since = new Date(Date.parse(until) - TELEMETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows: any[] = [];
  // Páginas abaixo do limite padrão do PostgREST; não perde registros após 1.000 chamadas.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('gemini_token_usage')
      .select('id, tenant_id, prompt_tokens, candidates_tokens, total_tokens, cached_tokens, provider, created_at, model, thinking_tokens')
      .gte('created_at', since).lte('created_at', until).order('created_at').order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) break;
  }

  const byTenant = new Map<
    string,
    {
      promptTokens: number;
      candidatesTokens: number;
      totalTokens: number;
      requestCount: number;
      cachedTokensSaved: number;
      estimatedCostUSD: number;
      cacheSavingsUSD: number;
      lastRequestAt: string;
      providerBreakdown: ProviderBreakdown;
    }
  >();
  for (const row of (rows || []) as any[]) {
    const acc = byTenant.get(row.tenant_id) || {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      cachedTokensSaved: 0,
      estimatedCostUSD: 0,
      cacheSavingsUSD: 0,
      lastRequestAt: row.created_at,
      providerBreakdown: emptyProviderBreakdown(),
    };
    const promptTokens = row.prompt_tokens || 0;
    const candidatesTokens = (row.candidates_tokens || 0) + (row.thinking_tokens || 0);
    const cachedTokens = row.cached_tokens || 0;
    // Linhas gravadas antes desta coluna existir não têm `provider` — trata
    // como 'gemini' (única origem possível até aqui), nunca descarta o dado.
    const provider: LlmProvider = row.provider === 'groq' ? 'groq' : 'gemini';
    const rowCostUSD = estimateUsageCostUSD(provider, promptTokens, candidatesTokens, cachedTokens, row.created_at, row.model);
    const rowCacheSavingsUSD = estimateCacheSavingsUSD(provider, cachedTokens, row.created_at, row.model);

    acc.promptTokens += promptTokens;
    acc.candidatesTokens += candidatesTokens;
    acc.totalTokens += row.total_tokens || 0;
    acc.cachedTokensSaved += cachedTokens;
    acc.estimatedCostUSD += rowCostUSD;
    acc.cacheSavingsUSD += rowCacheSavingsUSD;
    acc.requestCount += 1;
    if (row.created_at > acc.lastRequestAt) acc.lastRequestAt = row.created_at;
    acc.providerBreakdown[provider].tokens += row.total_tokens || 0;
    acc.providerBreakdown[provider].requests += 1;
    acc.providerBreakdown[provider].costUSD += rowCostUSD;
    byTenant.set(row.tenant_id, acc);
  }

  const tenantIds = [...byTenant.keys()];
  const namesById = new Map<string, string>();
  if (tenantIds.length) {
    const { data: tenants } = await db.from('tenants').select('id, name').in('id', tenantIds);
    for (const t of (tenants || []) as any[]) namesById.set(t.id, t.name);
  }

  const tenantsTelemetry: TenantTokenSummary[] = tenantIds
    .map((tenantId) => {
      const acc = byTenant.get(tenantId)!;
      return { tenantId, tenantName: namesById.get(tenantId) || tenantId, ...acc };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const summaryProviderBreakdown = tenantsTelemetry.reduce((acc, t) => {
    acc.gemini.tokens += t.providerBreakdown.gemini.tokens;
    acc.gemini.requests += t.providerBreakdown.gemini.requests;
    acc.gemini.costUSD += t.providerBreakdown.gemini.costUSD;
    acc.groq.tokens += t.providerBreakdown.groq.tokens;
    acc.groq.requests += t.providerBreakdown.groq.requests;
    acc.groq.costUSD += t.providerBreakdown.groq.costUSD;
    return acc;
  }, emptyProviderBreakdown());

  const summary: TokenTelemetrySummary = {
    legacyRequests: rows.filter(row => !row.model).length,
    unpricedRequests: rows.filter(row => !isKnownUsageModel(row.provider === 'groq' ? 'groq' : 'gemini', row.model)).length,
    totalSaaSTokens: tenantsTelemetry.reduce((sum, t) => sum + t.totalTokens, 0),
    totalSaaSCostUSD: tenantsTelemetry.reduce((sum, t) => sum + t.estimatedCostUSD, 0),
    totalCachedSaved: tenantsTelemetry.reduce((sum, t) => sum + t.cachedTokensSaved, 0),
    totalCacheSavingsUSD: tenantsTelemetry.reduce((sum, t) => sum + t.cacheSavingsUSD, 0),
    totalRequests: tenantsTelemetry.reduce((sum, t) => sum + t.requestCount, 0),
    providerBreakdown: summaryProviderBreakdown,
  };

  return { summary, tenantsTelemetry };
}

/** Usa somente o contexto autenticado/resolvido, nunca um tenant enviado no prompt. */
export function recordContextUsage(callSite: GeminiCallSite, usage: GeminiUsageMetadata | undefined, provider: LlmProvider, model: string): void {
  const tenantId = getTenantDbContext()?.tenantId;
  if (tenantId && usage) void recordGeminiUsage(tenantId, callSite, { ...usage, model }, provider);
}
