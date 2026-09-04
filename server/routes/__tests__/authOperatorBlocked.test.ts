/**
 * TASK-0261 — bloqueio reversível de operador (operators.is_active),
 * separado da exclusão definitiva já existente (DELETE /api/admin/operators/:id).
 * Mesmo raciocínio de ordem de checagem do bloqueio de tenant
 * (authTenantBlocked.test.ts): só verificado DEPOIS da senha validar, nunca
 * antes, senão vira um jeito de descobrir se uma conta está bloqueada sem
 * saber a senha dela.
 */
import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('senha-real-123', 10);
  const supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Tenant Normal', is_active: true }],
    operators: [
      { id: 'op-bloqueado', tenant_id: TENANT_ID, email: 'bloqueado@example.com', password_hash: passwordHash, name: 'Operador Bloqueado', role: 'operator', is_active: false },
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

describe('POST /api/auth/login — operador bloqueado', () => {
  it('recusa login com senha CORRETA quando operators.is_active=false', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bloqueado@example.com', password: 'senha-real-123' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/bloqueado/i);
    expect(data.token).toBeUndefined();
  });

  it('continua recusando com mensagem genérica quando a senha também está errada (não vaza que o operador está bloqueado antes de validar a senha)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bloqueado@example.com', password: 'senha-errada' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('E-mail ou senha incorretos.');
  });
});
