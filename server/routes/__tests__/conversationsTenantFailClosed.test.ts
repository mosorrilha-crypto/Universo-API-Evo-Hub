/**
 * Achado numa auditoria externa: tenantOf() caía silenciosamente no tenant
 * legado (dados reais da Monique) quando o JWT autenticado não trazia
 * tenantId, em vez de rejeitar — mesmo padrão de risco que o roteamento de
 * webhook por phone_number_id já tinha corrigido (Bloco 2.B). Trava que uma
 * sessão sem tenantId nunca lê/escreve nos dados do tenant legado.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;

function fakeAuthenticateTokenNoTenant(req: any, _res: any, next: any) {
  // Simula uma sessão autenticada cujo JWT não trouxe tenantId (o cenário
  // que antes caía silenciosamente no tenant legado).
  req.user = { id: 'op-sem-tenant', role: 'admin' };
  next();
}

beforeAll(async () => {
  initDb(createFakeSupabase({}));

  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateTokenNoTenant as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
    })
  );
  // Mesmo middleware de erro global do server.ts real — sem isso o Express
  // devolveria a página de erro HTML padrão em vez de JSON.
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

describe('tenantOf — nunca cai no tenant legado quando o JWT não traz tenantId', () => {
  it('GET /api/conversations rejeita (500) em vez de listar dados do tenant legado', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/tenantId/i);
  });

  it('GET /api/knowledge-base rejeita em vez de devolver a base do tenant legado', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`);
    expect(res.status).toBe(500);
  });
});
