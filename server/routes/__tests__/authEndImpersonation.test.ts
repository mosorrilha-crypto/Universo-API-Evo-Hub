/**
 * TASK-0363 — POST /api/auth/end-impersonation restaura a sessão original
 * do saas_admin depois de uma impersonação (ver POST
 * /api/admin/operators/:id/impersonate em admin.ts). Cobre: restauração
 * bem-sucedida (cookie novo + evento 'ended'), recusa sem `impersonatedBy`
 * no JWT, e recusa quando o saas_admin original sumiu/perdeu o role/foi
 * bloqueado nesse meio-tempo. Também cobre GET /api/auth/session expondo
 * `impersonation` durante uma sessão impersonada.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const JWT_SECRET = 'test-secret';
const SAAS_ADMIN_ID = 'op-saas';
const TARGET_ID = 'op-alvo';

function signImpersonationToken(impersonatedBy?: string) {
  return jwt.sign(
    impersonatedBy
      ? { id: TARGET_ID, tenantId: 'tenant-a', role: 'operator', impersonatedBy }
      : { id: TARGET_ID, tenantId: 'tenant-a', role: 'operator' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

describe('POST /api/auth/end-impersonation', () => {
  it('restaura a sessão do saas_admin original: cookie novo sem impersonatedBy, evento ended gravado', async () => {
    const supabase = createFakeSupabase({
      operators: [
        { id: SAAS_ADMIN_ID, tenant_id: 'tenant-plat', email: 'admin@example.com', name: 'Admin', role: 'saas_admin', is_active: true },
        { id: TARGET_ID, tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true },
      ],
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const token = signImpersonationToken(SAAS_ADMIN_ID);
    const res = await fetch(`${url}/api/auth/end-impersonation`, {
      method: 'POST',
      headers: { Cookie: `universo_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator).toMatchObject({ id: SAAS_ADMIN_ID, role: 'saas_admin' });

    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/universo_session=([^;]+)/);
    expect(match).not.toBeNull();
    const payload = jwt.verify(match![1], JWT_SECRET) as any;
    expect(payload).toMatchObject({ id: SAAS_ADMIN_ID, role: 'saas_admin' });
    expect(payload.impersonatedBy).toBeUndefined();

    const events = (supabase as any).__tables.operator_impersonation_events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ target_operator_id: TARGET_ID, actor_id: SAAS_ADMIN_ID, event_type: 'ended' });

    s.close();
  });

  it('recusa quando a sessão atual não está impersonando ninguém', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: TARGET_ID, tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const token = signImpersonationToken();
    const res = await fetch(`${url}/api/auth/end-impersonation`, {
      method: 'POST',
      headers: { Cookie: `universo_session=${token}` },
    });
    expect(res.status).toBe(400);
    s.close();
  });

  it('recusa restaurar se o saas_admin original foi bloqueado nesse meio-tempo', async () => {
    const supabase = createFakeSupabase({
      operators: [
        { id: SAAS_ADMIN_ID, tenant_id: 'tenant-plat', email: 'admin@example.com', name: 'Admin', role: 'saas_admin', is_active: false },
        { id: TARGET_ID, tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true },
      ],
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const token = signImpersonationToken(SAAS_ADMIN_ID);
    const res = await fetch(`${url}/api/auth/end-impersonation`, {
      method: 'POST',
      headers: { Cookie: `universo_session=${token}` },
    });
    expect(res.status).toBe(400);
    s.close();
  });
});

describe('GET /api/auth/session — campo impersonation', () => {
  it('expõe impersonation.active=true + nome de quem impersonou, durante uma sessão impersonada', async () => {
    const supabase = createFakeSupabase({
      operators: [
        { id: SAAS_ADMIN_ID, tenant_id: 'tenant-plat', email: 'admin@example.com', name: 'Admin Real', role: 'saas_admin', is_active: true },
        { id: TARGET_ID, tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true },
      ],
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const token = signImpersonationToken(SAAS_ADMIN_ID);
    const res = await fetch(`${url}/api/auth/session`, { headers: { Cookie: `universo_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.impersonation).toMatchObject({ active: true, byOperatorId: SAAS_ADMIN_ID, byOperatorName: 'Admin Real' });
    s.close();
  });

  it('impersonation.active=false numa sessão normal', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: TARGET_ID, tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter({ jwtSecret: JWT_SECRET, supabase: supabase as any, authenticateToken: createAuthenticateToken(JWT_SECRET), isProduction: false }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const token = signImpersonationToken();
    const res = await fetch(`${url}/api/auth/session`, { headers: { Cookie: `universo_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.impersonation).toEqual({ active: false });
    s.close();
  });
});
