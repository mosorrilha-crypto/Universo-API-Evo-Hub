import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { runWithTenantDbContext, disableTenantDbContextForTests } from '../tenantDbContext';
import { callGroqJsonCompletion } from '../groqClient';
import { getTokenTelemetry, recordContextUsage } from '../tokenUsageStore';
afterEach(() => { vi.unstubAllGlobals(); disableTenantDbContextForTests(); });
describe('Instrumentação no contexto resolvido', () => {
  it('grava o modelo real antes de validar JSON e não depende do conteúdo do prompt', async () => {
    const db = createFakeSupabase(); initDb(db);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'invalid json' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }))));
    await runWithTenantDbContext({ tenantId: 'tenant-a', source: 'job' }, async () => {
      await expect(callGroqJsonCompletion('key', 'tenant-b', 6000, 'openai/gpt-oss-120b')).rejects.toThrow('JSON válido');
    });
    expect(db.__tables.gemini_token_usage).toHaveLength(1);
    expect(db.__tables.gemini_token_usage[0]).toMatchObject({ tenant_id: 'tenant-a', model: 'openai/gpt-oss-120b', provider: 'groq', total_tokens: 30 });
  });
  it('sem contexto confiável não atribui consumo a uma empresa inventada', () => {
    const db = createFakeSupabase(); initDb(db);
    recordContextUsage('analise', { totalTokenCount: 1 }, 'gemini', 'gemini-3.5-flash-lite');
    expect(db.__tables.gemini_token_usage || []).toHaveLength(0);
  });
  it('analise Gemini inclui modelo e raciocínio, separadamente da saída visível', async () => {
    const db = createFakeSupabase(); initDb(db);
    await runWithTenantDbContext({ tenantId: 'tenant-a', source: 'authenticated_request' }, async () => {
      recordContextUsage('analise', { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 40, totalTokenCount: 160 }, 'gemini', 'gemini-3.5-flash-lite');
    });
    expect(db.__tables.gemini_token_usage[0]).toMatchObject({ model: 'gemini-3.5-flash-lite', thinking_tokens: 40, candidates_tokens: 20 });
    const { summary } = await getTokenTelemetry();
    expect(summary.totalSaaSCostUSD).toBeCloseTo(0.00018, 8);
  });
});
