/**
 * TASK-0070 — bloqueio de acesso por tenant (tenants.is_active). Um
 * saas_admin pode "desligar" o acesso de um tenant inteiro sem apagar
 * nada (reversível, diferente do DELETE de tenant que já existe e é
 * irreversível). O bloqueio precisa acontecer DEPOIS da senha validar
 * (nunca antes) — senão vira um jeito de descobrir se um tenant está
 * bloqueado sem saber a senha de ninguém dele.
 */
import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('senha-real-123', 10);
  const supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Tenant Bloqueado', is_active: false }],
    operators: [
      { id: 'op-1', tenant_id: TENANT_ID, email: 'operador@bloqueado.com', password_hash: passwordHash, name: 'Operador', role: 'admin' },
    ],
  });

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ jwtSecret: 'test-secret', supabase }));

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

describe('POST /api/auth/login — tenant bloqueado', () => {
  it('recusa login com senha CORRETA quando is_active=false', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operador@bloqueado.com', password: 'senha-real-123' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/bloqueado/i);
    expect(data.token).toBeUndefined();
  });

  it('continua recusando com mensagem genérica quando a senha também está errada (não vaza que o tenant está bloqueado antes de validar a senha)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operador@bloqueado.com', password: 'senha-errada' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('E-mail ou senha incorretos.');
  });
});
