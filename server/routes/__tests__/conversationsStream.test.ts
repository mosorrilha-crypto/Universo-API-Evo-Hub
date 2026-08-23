/**
 * GET /api/conversations/stream (SSE) — avisa o painel em tempo real no
 * lugar do polling de 8s (ver server/services/conversationEvents.ts).
 * EventSource não manda header Authorization, então essa rota autentica
 * via query string (?token=) com o mesmo segredo/algoritmo de
 * authenticateToken, nunca confiando em tenantId vindo de fora do JWT.
 */
import express from 'express';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { emitConversationUpdated } from '../../services/conversationEvents';

const TENANT_A = 'tenant-a';
const JWT_SECRET = 'test-secret';

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      jwtSecret: JWT_SECRET,
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn',
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('GET /api/conversations/stream', () => {
  it('sem token — recusa (401), nunca abre o stream', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/stream`);
    expect(res.status).toBe(401);
  });

  it('token inválido/expirado — recusa (403), nunca abre o stream', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/stream?token=lixo-nao-e-jwt`);
    expect(res.status).toBe(403);
  });

  it('token válido — abre o stream e entrega evento do próprio tenant', async () => {
    const token = jwt.sign({ id: 'op-1', tenantId: TENANT_A, role: 'admin' }, JWT_SECRET);
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/stream?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    // Dá tempo do servidor registrar a assinatura (subscribeTenant) antes de emitir.
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitConversationUpdated(TENANT_A, '595985407441');

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('data: {"phone":"595985407441"}');

    controller.abort();
  });

  // Achado real em produção (15/08/2026): o seletor de tenant do painel
  // (saas_admin) precisa que ESTE stream também acompanhe o tenant
  // selecionado, não só as chamadas REST via apiFetch (que já mandam
  // X-Tenant-Id) — EventSource nativo não manda header customizado, então
  // esse tenant só pode vir por querystring aqui (ver resolveTenantId em
  // middleware/rbac.ts pra mesma exceção nas outras rotas).
  it('saas_admin com ?tenantId= — assina o tenant apontado, não o do próprio login', async () => {
    const TENANT_B = 'tenant-b';
    const token = jwt.sign({ id: 'op-1', tenantId: TENANT_A, role: 'saas_admin' }, JWT_SECRET);
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/stream?token=${encodeURIComponent(token)}&tenantId=${TENANT_B}`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Evento do tenant do PRÓPRIO login (TENANT_A) não deveria chegar aqui.
    emitConversationUpdated(TENANT_A, '595900000001');
    // Evento do tenant apontado pelo querystring (TENANT_B) deveria chegar.
    emitConversationUpdated(TENANT_B, '595900000002');

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('data: {"phone":"595900000002"}');
    expect(chunk).not.toContain('595900000001');

    controller.abort();
  });

  it('admin comum (não saas_admin) com ?tenantId= — ignorado, assina sempre o próprio tenant do JWT', async () => {
    const TENANT_B = 'tenant-b';
    const token = jwt.sign({ id: 'op-1', tenantId: TENANT_A, role: 'admin' }, JWT_SECRET);
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/stream?token=${encodeURIComponent(token)}&tenantId=${TENANT_B}`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    await new Promise((resolve) => setTimeout(resolve, 50));

    emitConversationUpdated(TENANT_B, '595900000003');
    emitConversationUpdated(TENANT_A, '595900000004');

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('data: {"phone":"595900000004"}');
    expect(chunk).not.toContain('595900000003');

    controller.abort();
  });
});
