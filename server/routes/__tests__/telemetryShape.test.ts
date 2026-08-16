/**
 * Achado real em produção: /api/telemetry/tokens respondia com números
 * fabricados (tenant fictício "Clínica Odonto Prime" incluído) usando nomes
 * de campo diferentes dos que o frontend espera (TenantTokenTelemetry em
 * src/types.ts) — o campo "totalTokens" nunca existia na resposta, e o
 * painel "Telemetria de Tokens IA" chamava .toLocaleString() nele sem
 * nenhuma guarda, jogando a tela inteira em branco (React desmonta a árvore
 * num erro de render sem Error Boundary). Esses testes travam o formato
 * exato que o frontend espera pra nunca mais divergir em silêncio.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTelemetryRouter } from '../telemetry';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: 'tenant-a', role: 'saas_admin' };
  next();
}

beforeAll(async () => {
  supabase = createFakeSupabase();
  initDb(supabase);
  const app = express();
  app.use(express.json());
  app.use(createTelemetryRouter({ authenticateToken: fakeAuthenticateToken as any }));
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Erro interno do servidor.' });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('GET /api/telemetry/tokens — formato honesto, sem dado fabricado', () => {
  it('nunca inclui um tenant fictício e usa os nomes de campo que o frontend espera', async () => {
    const res = await fetch(`${baseUrl}/api/telemetry/tokens`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.tenantsTelemetry).toEqual([]);
    expect(data.summary).toEqual({
      totalSaaSTokens: 0,
      totalSaaSCostUSD: 0,
      totalCachedSaved: 0,
      totalRequests: 0,
      providerBreakdown: { gemini: { tokens: 0, requests: 0 }, groq: { tokens: 0, requests: 0 } },
    });
    // Nunca mais um nome fictício de tenant na resposta desta rota.
    expect(JSON.stringify(data)).not.toContain('Odonto');
  });

  it('achado real em produção (13/08/2026): cada registro por tenant tem exatamente os campos de TenantTokenTelemetry (src/types.ts) — sem "estimatedCostUSD" nenhum, campo que só o frontend achava que existia e nunca veio do backend; o frontend lia `tRecord.estimatedCostUSD.toFixed(5)` sobre `undefined` assim que telemetria real (não mais vazia) chegava, jogando a aba "Telemetria de Tokens IA" inteira em branco (React desmonta a árvore sem Error Boundary)', async () => {
    supabase.__tables['tenants'] = [{ id: 'tenant-real-1', name: 'Cliente Real' }];
    supabase.__tables['gemini_token_usage'] = [
      { tenant_id: 'tenant-real-1', prompt_tokens: 100, candidates_tokens: 40, total_tokens: 140, cached_tokens: 10, created_at: new Date().toISOString() },
    ];

    const res = await fetch(`${baseUrl}/api/telemetry/tokens`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.tenantsTelemetry).toHaveLength(1);
    const record = data.tenantsTelemetry[0];
    expect(Object.keys(record).sort()).toEqual(
      ['candidatesTokens', 'cachedTokensSaved', 'lastRequestAt', 'promptTokens', 'providerBreakdown', 'requestCount', 'tenantId', 'tenantName', 'totalTokens'].sort()
    );
    expect(record).not.toHaveProperty('estimatedCostUSD');
    expect(record.tenantName).toBe('Cliente Real');
    expect(record.totalTokens).toBe(140);
  });
});

describe('GET /api/queue/status — nomes de campo batendo com QueueSystemStatus do frontend', () => {
  it('responde com activeJobs/waitingJobs/completedJobs/failedJobs (não os nomes internos da fila)', async () => {
    const res = await fetch(`${baseUrl}/api/queue/status`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toHaveProperty('activeJobs');
    expect(data).toHaveProperty('waitingJobs');
    expect(data).toHaveProperty('completedJobs');
    expect(data).toHaveProperty('failedJobs');
    expect(typeof data.completedJobs).toBe('number');
    // Nomes internos antigos (getQueueStats()) nunca devem vazar pra fora sem mapeamento.
    expect(data).not.toHaveProperty('activeWorkers');
    expect(data).not.toHaveProperty('processedTotal');
  });
});

describe('POST /api/batch/lead-analysis — removida (issue #82, item 1)', () => {
  it('não existe mais nenhuma rota que fabricava sucesso/números fixos de processamento em lote', async () => {
    const res = await fetch(`${baseUrl}/api/batch/lead-analysis`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
