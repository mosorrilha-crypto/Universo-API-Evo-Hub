/**
 * TASK-0218 — o botão "Autenticar com Conta do Google" existia no painel
 * desde antes mas nunca emitia um JWT de backend de verdade (só provava
 * posse do e-mail via Firebase client-side). Este teste prova a rota real
 * fim a fim: token verificado, e-mail cruzado contra `operators`, e a
 * política de nunca criar operador automaticamente pra um e-mail Google
 * sem cadastro prévio.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const verifyGoogleIdTokenMock = vi.fn();

vi.mock('../../services/firebaseAdmin', async () => {
  const actual = await vi.importActual<typeof import('../../services/firebaseAdmin')>('../../services/firebaseAdmin');
  return {
    ...actual,
    verifyGoogleIdToken: verifyGoogleIdTokenMock,
  };
});

const { createAuthRouter } = await import('../auth');
const { createAuthenticateToken } = await import('../../middleware/auth');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');
const { FirebaseAdminNotConfiguredError } = await import('../../services/firebaseAdmin');

const TENANT_UUID = '22222222-2222-2222-2222-222222222222';
const CADASTRADO_EMAIL = 'operador.google@example.com';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const supabase = createFakeSupabase({
    tenants: [{ id: TENANT_UUID, is_active: true }],
    operators: [
      { id: 'op-google-1', tenant_id: TENANT_UUID, email: CADASTRADO_EMAIL, password_hash: 'irrelevante-pra-login-google', name: 'Operador Google', role: 'manager' },
    ],
  });

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ jwtSecret: 'test-secret', supabase, authenticateToken: createAuthenticateToken('test-secret') }));

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

function loginWithGoogle(idToken = 'qualquer-token') {
  return fetch(`${baseUrl}/api/auth/login-google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
}

describe('POST /api/auth/login-google', () => {
  it('emite um JWT de verdade quando o e-mail verificado corresponde a um operador cadastrado', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({ email: CADASTRADO_EMAIL, emailVerified: true });

    const res = await loginWithGoogle();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.operator).toEqual({ name: 'Operador Google', email: CADASTRADO_EMAIL, role: 'manager', tenantId: TENANT_UUID });
  });

  it('rejeita quando o e-mail verificado não corresponde a nenhum operador cadastrado — nunca cria operador automaticamente', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({ email: 'desconhecido@example.com', emailVerified: true });

    const res = await loginWithGoogle();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/não está cadastrada como operador/i);
  });

  it('rejeita quando o e-mail do Google ainda não foi verificado', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({ email: CADASTRADO_EMAIL, emailVerified: false });

    const res = await loginWithGoogle();
    expect(res.status).toBe(401);
  });

  it('rejeita com 401 quando o token do Google é inválido/expirado', async () => {
    verifyGoogleIdTokenMock.mockRejectedValue(new Error('Firebase ID token has expired'));

    const res = await loginWithGoogle();
    expect(res.status).toBe(401);
  });

  it('devolve 503 quando o Firebase Admin não está configurado neste servidor', async () => {
    verifyGoogleIdTokenMock.mockRejectedValue(new FirebaseAdminNotConfiguredError());

    const res = await loginWithGoogle();
    expect(res.status).toBe(503);
  });
});
