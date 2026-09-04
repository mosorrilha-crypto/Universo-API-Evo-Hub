/**
 * Achado de segurança (02/09/2026, auditoria comparando com o DeskcommCRM):
 * POST /api/auth/login não tinha nenhum limite de tentativas — um atacante
 * tinha tentativas ilimitadas de senha contra qualquer e-mail conhecido.
 * Este teste prova o bloqueio por conta fim a fim, passando pela rota real
 * (não só a unidade em authLoginAttempts.test.ts).
 */
import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { resetAuthLoginAttemptsForTests } from '../../services/authLoginAttempts';

const TENANT_UUID = '11111111-1111-1111-1111-111111111111';
const EMAIL = 'vitima@example.com';
const REAL_PASSWORD = 'senha-real-123';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(REAL_PASSWORD, 10);
  const supabase = createFakeSupabase({
    operators: [
      { id: 'op-1', tenant_id: TENANT_UUID, email: EMAIL, password_hash: passwordHash, name: 'Vítima', role: 'admin' },
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

afterEach(() => {
  resetAuthLoginAttemptsForTests();
});

afterAll(() => {
  server.close();
});

function attemptLogin(password: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
}

describe('POST /api/auth/login — bloqueio por conta após falhas repetidas', () => {
  it('permite algumas tentativas erradas antes de bloquear', async () => {
    for (let i = 0; i < 4; i += 1) {
      const res = await attemptLogin('senha-errada');
      expect(res.status).toBe(401);
    }
    // A 5ª falha ainda não bloqueou a PRÓXIMA tentativa — o limite é
    // "5 falhas já registradas", não "a 5ª tentativa passa".
    const withRealPassword = await attemptLogin(REAL_PASSWORD);
    expect(withRealPassword.status).toBe(200);
  });

  it('bloqueia a conta mesmo com a senha certa depois de 5 falhas', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await attemptLogin('senha-errada');
      expect(res.status).toBe(401);
    }
    const withRealPassword = await attemptLogin(REAL_PASSWORD);
    expect(withRealPassword.status).toBe(401);
    const body = await withRealPassword.json();
    // Mesma mensagem genérica de sempre — não revela que a conta está
    // bloqueada (evitaria diferenciar "senha errada" de "bloqueada").
    expect(body.error).toBe('E-mail ou senha incorretos.');
  });

  it('um login bem-sucedido depois zera o histórico — não fica bloqueado pra sempre por falhas antigas isoladas', async () => {
    for (let i = 0; i < 3; i += 1) {
      await attemptLogin('senha-errada');
    }
    const success = await attemptLogin(REAL_PASSWORD);
    expect(success.status).toBe(200);

    // Novas falhas depois do sucesso partem de zero, não continuam de 3.
    for (let i = 0; i < 4; i += 1) {
      const res = await attemptLogin('senha-errada');
      expect(res.status).toBe(401);
    }
    const stillWorks = await attemptLogin(REAL_PASSWORD);
    expect(stillWorks.status).toBe(200);
  });
});
