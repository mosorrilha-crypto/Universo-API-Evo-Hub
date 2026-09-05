/**
 * TASK-0261 — PUT /api/auth/password, troca de senha pelo próprio operador.
 * Diferente do reset feito por um admin (PATCH /api/admin/operators/:id,
 * onde é o admin quem escolhe a senha e portanto sempre sabe qual é), aqui
 * a senha nova nunca é lida nem logada em lugar nenhum — só vira hash.
 * Exige a senha ATUAL (não só um JWT válido), pra uma sessão sequestrada
 * não conseguir trocar a senha do dono de fora sem saber a antiga.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAuthRouter } from '../auth';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const JWT_SECRET = 'test-secret';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = 'op-troca-senha';
const CURRENT_PASSWORD = 'senha-atual-123';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(CURRENT_PASSWORD, 10);
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Tenant', is_active: true }],
    operators: [
      { id: OPERATOR_ID, tenant_id: TENANT_ID, email: 'eu@example.com', password_hash: passwordHash, name: 'Eu', role: 'operator' },
    ],
  });

  const app = express();
  app.use(express.json());
  // Servidor de teste efêmero, sem tráfego real — CodeQL não distingue isso
  // de um app em produção (ver rationale completa em server.ts). Regra
  // js/missing-token-validation excluída via .github/codeql/codeql-config.yml.
  app.use(cookieParser());
  app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));

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

function tokenFor(id: string) {
  return jwt.sign({ id, tenantId: TENANT_ID, role: 'operator' }, JWT_SECRET, { expiresIn: '1h' });
}

// TASK-0311 (TASK-0249 item 1): a sessão deixou de vir por header
// `Authorization` e passou a vir só pelo cookie httpOnly `universo_session`
// (ver server/middleware/auth.ts) — simula isso mandando o JWT via `Cookie`.
function changePassword(token: string | null, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/auth/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `universo_session=${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/auth/password', () => {
  it('exige autenticação — sem token, 401', async () => {
    const res = await changePassword(null, { currentPassword: CURRENT_PASSWORD, newPassword: 'nova-senha-456' });
    expect(res.status).toBe(401);
  });

  it('rejeita quando a senha atual está errada', async () => {
    const res = await changePassword(tokenFor(OPERATOR_ID), { currentPassword: 'senha-errada', newPassword: 'nova-senha-456' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/senha atual/i);
  });

  it('rejeita nova senha curta (menos de 6 caracteres)', async () => {
    const res = await changePassword(tokenFor(OPERATOR_ID), { currentPassword: CURRENT_PASSWORD, newPassword: '123' });
    expect(res.status).toBe(400);
  });

  it('troca a senha de verdade: login antigo para de funcionar, login novo funciona', async () => {
    const res = await changePassword(tokenFor(OPERATOR_ID), { currentPassword: CURRENT_PASSWORD, newPassword: 'senha-nova-789' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'eu@example.com', password: CURRENT_PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'eu@example.com', password: 'senha-nova-789' }),
    });
    expect(newLogin.status).toBe(200);
  });
});
