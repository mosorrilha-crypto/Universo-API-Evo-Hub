/**
 * Telemetria real de tokens Gemini por tenant — GitHub issue #90. Antes
 * disso não existia nenhuma gravação de usageMetadata no backend.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordGeminiUsage, getTokenTelemetry } from '../tokenUsageStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase({
    tenants: [
      { id: TENANT_A, name: 'Monique Beauty Studio' },
      { id: TENANT_B, name: 'Outro Tenant' },
    ],
  });
  initDb(supabase);
});

describe('recordGeminiUsage', () => {
  it('grava uma linha por chamada, com os campos certos', async () => {
    await recordGeminiUsage(TENANT_A, 'router', { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150, cachedContentTokenCount: 10 });
    const rows = supabase.__tables.gemini_token_usage;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      call_site: 'router',
      prompt_tokens: 120,
      candidates_tokens: 30,
      total_tokens: 150,
      cached_tokens: 10,
    });
  });

  it('sem usageMetadata (undefined), não grava nada — nunca inventa número que a API não devolveu', async () => {
    await recordGeminiUsage(TENANT_A, 'router', undefined);
    expect(supabase.__tables.gemini_token_usage ?? []).toHaveLength(0);
  });

  it('nunca lança, mesmo se o insert falhar (telemetria não pode derrubar o fluxo do agente)', async () => {
    initDb(null as any); // getDb() vai lançar "banco não configurado"
    await expect(recordGeminiUsage(TENANT_A, 'router', { totalTokenCount: 10 })).resolves.toBeUndefined();
  });
});

describe('getTokenTelemetry', () => {
  it('sem nenhuma chamada gravada, devolve tudo zerado/vazio — nunca um tenant fictício', async () => {
    const { summary, tenantsTelemetry } = await getTokenTelemetry();
    expect(tenantsTelemetry).toEqual([]);
    expect(summary).toEqual({ totalSaaSTokens: 0, totalSaaSCostUSD: 0, totalCachedSaved: 0, totalRequests: 0 });
  });

  it('agrega múltiplas chamadas do mesmo tenant e resolve o nome real', async () => {
    await recordGeminiUsage(TENANT_A, 'router', { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120, cachedContentTokenCount: 5 });
    await recordGeminiUsage(TENANT_A, 'especialista', { promptTokenCount: 200, candidatesTokenCount: 50, totalTokenCount: 250, cachedContentTokenCount: 0 });

    const { summary, tenantsTelemetry } = await getTokenTelemetry();
    expect(tenantsTelemetry).toHaveLength(1);
    expect(tenantsTelemetry[0]).toMatchObject({
      tenantId: TENANT_A,
      tenantName: 'Monique Beauty Studio',
      promptTokens: 300,
      candidatesTokens: 70,
      totalTokens: 370,
      requestCount: 2,
      cachedTokensSaved: 5,
    });
    expect(summary).toEqual({ totalSaaSTokens: 370, totalSaaSCostUSD: 0, totalCachedSaved: 5, totalRequests: 2 });
  });

  it('isolamento: cada tenant só soma o próprio uso, ordenado do maior consumo pro menor', async () => {
    await recordGeminiUsage(TENANT_A, 'router', { totalTokenCount: 50 });
    await recordGeminiUsage(TENANT_B, 'router', { totalTokenCount: 500 });

    const { tenantsTelemetry } = await getTokenTelemetry();
    expect(tenantsTelemetry.map((t) => t.tenantId)).toEqual([TENANT_B, TENANT_A]);
  });

  it('ignora chamadas fora da janela de 30 dias', async () => {
    await recordGeminiUsage(TENANT_A, 'router', { totalTokenCount: 999 });
    // Sobrescreve created_at pra fora da janela, direto na tabela fake.
    supabase.__tables.gemini_token_usage[0].created_at = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    const { tenantsTelemetry } = await getTokenTelemetry();
    expect(tenantsTelemetry).toEqual([]);
  });
});
