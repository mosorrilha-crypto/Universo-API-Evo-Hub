/**
 * Uso real de tokens Gemini por tenant — GitHub issue #90. Antes disso,
 * `/api/telemetry/tokens` respondia vazio honestamente, mas nenhuma
 * gravação de `usageMetadata` existia no backend. Ver
 * server/services/autoReply.ts (withGeminiRetry) para os 4 pontos de
 * chamada que gravam aqui.
 */
import { getDb } from './db';

export type GeminiCallSite = 'router' | 'especialista' | 'agendamento' | 'foto';

/** Router-fallback Groq (plano aprovado): qual provedor gerou a chamada, pra não misturar custo/volume dos dois na telemetria. Ausente/legado = 'gemini'. */
export type LlmProvider = 'gemini' | 'groq';

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
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
    await db.from('gemini_token_usage').insert({
      tenant_id: tenantId,
      call_site: callSite,
      provider,
      prompt_tokens: usage.promptTokenCount || 0,
      candidates_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
      cached_tokens: usage.cachedContentTokenCount || 0,
      // Explícito em vez de confiar no default do Postgres (now()) — a
      // agregação por janela de tempo (getTokenTelemetry) precisa desse
      // valor logo após o insert, sem round-trip extra pra ler de volta.
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('⚠️  [Telemetria] falha ao gravar uso de tokens Gemini/Groq (não bloqueia o agente):', (err as Error)?.message || err);
  }
}

export interface TenantTokenSummary {
  tenantId: string;
  tenantName: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  requestCount: number;
  cachedTokensSaved: number;
  lastRequestAt: string;
}

export interface TokenTelemetrySummary {
  totalSaaSTokens: number;
  totalSaaSCostUSD: number;
  totalCachedSaved: number;
  totalRequests: number;
}

const TELEMETRY_WINDOW_DAYS = 30;

/**
 * Agregado por tenant dos últimos TELEMETRY_WINDOW_DAYS dias — agregação em
 * JS (não GROUP BY no Postgres), consistente com o volume real do projeto
 * hoje (poucos tenants, baixo volume de mensagens); revisar se algum dia
 * isso virar um gargalo de verdade.
 *
 * `estimatedCostUSD` fica sempre 0: não existe uma constante confiável de
 * preço por token pro modelo em uso neste projeto — reportar um custo
 * estimado sem fonte real seria inventar dado de negócio (CLAUDE.md:
 * "AI fallbacks never fabricate business data"). Volta a computar de
 * verdade quando houver um preço por token confirmado.
 */
export async function getTokenTelemetry(): Promise<{ summary: TokenTelemetrySummary; tenantsTelemetry: TenantTokenSummary[] }> {
  const db = getDb();
  const since = new Date(Date.now() - TELEMETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await db
    .from('gemini_token_usage')
    .select('tenant_id, prompt_tokens, candidates_tokens, total_tokens, cached_tokens, created_at')
    .gte('created_at', since);
  if (error) throw error;

  const byTenant = new Map<string, { promptTokens: number; candidatesTokens: number; totalTokens: number; requestCount: number; cachedTokensSaved: number; lastRequestAt: string }>();
  for (const row of (rows || []) as any[]) {
    const acc = byTenant.get(row.tenant_id) || { promptTokens: 0, candidatesTokens: 0, totalTokens: 0, requestCount: 0, cachedTokensSaved: 0, lastRequestAt: row.created_at };
    acc.promptTokens += row.prompt_tokens || 0;
    acc.candidatesTokens += row.candidates_tokens || 0;
    acc.totalTokens += row.total_tokens || 0;
    acc.cachedTokensSaved += row.cached_tokens || 0;
    acc.requestCount += 1;
    if (row.created_at > acc.lastRequestAt) acc.lastRequestAt = row.created_at;
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

  const summary: TokenTelemetrySummary = {
    totalSaaSTokens: tenantsTelemetry.reduce((sum, t) => sum + t.totalTokens, 0),
    totalSaaSCostUSD: 0,
    totalCachedSaved: tenantsTelemetry.reduce((sum, t) => sum + t.cachedTokensSaved, 0),
    totalRequests: tenantsTelemetry.reduce((sum, t) => sum + t.requestCount, 0),
  };

  return { summary, tenantsTelemetry };
}
