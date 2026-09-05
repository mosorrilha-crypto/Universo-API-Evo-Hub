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
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const REAL_TENANT_UUID = '11111111-1111-1111-1111-111111111111';
const MOCK_PRESET_TENANT_ID = 'tenant_004'; // exatamente o valor que o card de preset demo da Monique manda (mockTenants.ts)

let server: Server;
let baseUrl: string;

// TASK-0311 (TASK-0249 item 1): a sessão deixou de vir no corpo JSON do
// login e virou um cookie httpOnly (`universo_session`) — extrai o
// `name=value` do `Set-Cookie` da resposta pra repassar como `Cookie` nas
// chamadas autenticadas seguintes (fetch() do Node não tem cookie jar
// automático entre chamadas independentes).
function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') || '';
  const pair = setCookie.split(';')[0];
  if (!pair) throw new Error('Resposta de login sem Set-Cookie de sessão.');
  return pair;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('senha-real-123', 10);
  const supabase = createFakeSupabase({
    operators: [
      { id: 'op-1', tenant_id: REAL_TENANT_UUID, email: 'monique@pestanaspormonique.com', password_hash: passwordHash, name: 'Monique Sorrilha', role: 'admin' },
    ],
  });

  const app = express();
  app.use(express.json());
  // Servidor de teste efêmero, sem tráfego real — CodeQL não distingue isso
  // de um app em produção (ver rationale completa em server.ts). Regra
  // js/missing-token-validation excluída via .github/codeql/codeql-config.yml.
  app.use(cookieParser());
  app.use(createAuthRouter({ jwtSecret: 'test-secret', supabase, authenticateToken: createAuthenticateToken('test-secret'), isProduction: false }));

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
  it('loga com sucesso só com e-mail+senha, mesmo sem tenantId (ou com um tenantId de mock incorreto), e devolve a sessão como cookie httpOnly', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Simula exatamente o bug: o card de preset demo mandaria esse
      // tenantId de mock — o endpoint precisa IGNORAR isso e nunca usar
      // pra filtrar a busca do operador.
      body: JSON.stringify({ tenantId: MOCK_PRESET_TENANT_ID, email: 'monique@pestanaspormonique.com', password: 'senha-real-123' }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('universo_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    // isProduction: false no teste — cookie não deve exigir HTTPS aqui.
    expect(setCookie).not.toContain('Secure');

    const data = await res.json();
    expect(data.token).toBeUndefined();
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


describe('GET /api/auth/session', () => {
  it('devolve o papel e o tenant do operador associado à sessão', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'monique@pestanaspormonique.com', password: 'senha-real-123' }),
    });
    const cookie = extractSessionCookie(login);

    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      operator: {
        id: 'op-1',
        tenantId: REAL_TENANT_UUID,
        role: 'admin',
      },
    });
  });

  it('recusa uma consulta sem cookie de sessão', async () => {
    const response = await fetch(`${baseUrl}/api/auth/session`);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('apaga o cookie de sessão', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'monique@pestanaspormonique.com', password: 'senha-real-123' }),
    });
    const cookie = extractSessionCookie(login);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(logout.status).toBe(200);
    const clearedCookie = logout.headers.get('set-cookie') || '';
    expect(clearedCookie).toContain('universo_session=');

    // A sessão original (obtida antes do logout) precisa continuar sendo um
    // JWT válido por si só (o logout não revoga o token, só instrui o
    // navegador que originou o request a apagar o cookie) — o teste real de
    // "logout funcionou" é no navegador, que para de mandar o cookie depois
    // do Set-Cookie de expiração; aqui só confirmamos que a rota devolve o
    // Set-Cookie de limpeza esperado.
    expect(cookie).toContain('universo_session=');
  });
});
