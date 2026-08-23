/**
 * Regressão de um bug crítico em produção: com DEMO_MODE=false, o painel
 * mandava pro /api/auth/login o tenantId de MOCK do card de preset demo
 * selecionado (ex: "tenant_004", de src/data/mockTenants.ts) — nunca bate
 * com o tenant_id real (UUID) de nenhum operador de verdade no Supabase,
 * então TODO login real falhava com "E-mail ou senha incorretos", mesmo
 * com a senha certa. A correção: buscar o operador só por e-mail
 * (case-insensitive), nunca por um tenantId adivinhado pelo cliente.
 */
import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const REAL_TENANT_UUID = '11111111-1111-1111-1111-111111111111';
const MOCK_PRESET_TENANT_ID = 'tenant_004'; // exatamente o valor que o card de preset demo da Monique manda (mockTenants.ts)

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('senha-real-123', 10);
  const supabase = createFakeSupabase({
    operators: [
      { id: 'op-1', tenant_id: REAL_TENANT_UUID, email: 'monique@pestanaspormonique.com', password_hash: passwordHash, name: 'Monique Sorrilha', role: 'admin' },
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

describe('POST /api/auth/login', () => {
  it('loga com sucesso só com e-mail+senha, mesmo sem tenantId (ou com um tenantId de mock incorreto)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Simula exatamente o bug: o card de preset demo mandaria esse
      // tenantId de mock — o endpoint precisa IGNORAR isso e nunca usar
      // pra filtrar a busca do operador.
      body: JSON.stringify({ tenantId: MOCK_PRESET_TENANT_ID, email: 'monique@pestanaspormonique.com', password: 'senha-real-123' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.operator.email).toBe('monique@pestanaspormonique.com');
    expect(data.operator.tenantId).toBe(REAL_TENANT_UUID);
  });

  it('e-mail é case-insensitive', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'MONIQUE@PestanasPorMonique.com', password: 'senha-real-123' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejeita senha errada', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'monique@pestanaspormonique.com', password: 'senha-errada' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejeita e-mail que não existe', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ninguem@example.com', password: 'qualquer' }),
    });
    expect(res.status).toBe(401);
  });
});
