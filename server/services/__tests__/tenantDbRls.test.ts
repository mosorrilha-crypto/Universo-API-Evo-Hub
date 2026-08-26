import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from '../../config';
import { createTenantRuntimeAccessToken } from '../../supabaseClient';
import { getDb, getPlatformDb, initDb } from '../db';
import { disableTenantDbContextForTests, runWithTenantDbContext } from '../tenantDbContext';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const ACTOR_A = '22222222-2222-2222-2222-222222222222';
const RUNTIME_SECRET = 'tenant-runtime-test-secret';

const config: ServerConfig = {
  port: 3000,
  isProduction: true,
  jwtSecret: 'application-test-secret',
  supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'sb_secret_platform_test',
  supabasePublishableKey: 'sb_publishable_runtime_test',
  supabaseJwtSecret: RUNTIME_SECRET,
  rlsEnforced: true,
  metaWebhookVerifyToken: 'meta-test-token',
  publicBaseUrl: 'https://example.test',
  googleRedirectUri: 'https://example.test/callback',
  vapidSubject: 'mailto:test@example.test',
};

describe('camada de dados com RLS efetivo', () => {
  const platformClient = {} as SupabaseClient;

  beforeEach(() => {
    disableTenantDbContextForTests();
    initDb(platformClient, config);
  });

  afterEach(() => {
    disableTenantDbContextForTests();
    initDb(null);
  });

  it('recusa acesso de aplicação sem contexto de tenant quando RLS está ativo', () => {
    expect(() => getDb()).toThrow(/sem contexto de tenant/i);
  });

  it('mantém o cliente privilegiado acessível somente pelo escape hatch explícito', () => {
    expect(getPlatformDb()).toBe(platformClient);
  });

  it('cria um cliente de runtime diferente do cliente de plataforma dentro do contexto validado', async () => {
    await runWithTenantDbContext(
      { tenantId: TENANT_A, actorId: ACTOR_A, role: 'admin', source: 'authenticated_request' },
      async () => {
        await Promise.resolve();
        expect(getDb()).not.toBe(platformClient);
      }
    );
  });

  it('permite que um job de fundo (sem requisição HTTP) processe um tenant via runWithTenantDbContext com source "job"', async () => {
    // TASK-0083: jobs periódicos (setInterval/startPeriodicJob) não têm contexto
    // de tenant do AsyncLocalStorage por padrão — sem esse wrap, getDb() dentro
    // do processamento por-tenant do job rejeitava tudo (regressão real após o
    // rollout de RLS, achada nos logs de produção via mcp__Render__list_logs).
    expect(() => getDb()).toThrow(/sem contexto de tenant/i);
    await runWithTenantDbContext({ tenantId: TENANT_A, source: 'job' }, async () => {
      await Promise.resolve();
      expect(getDb()).not.toBe(platformClient);
    });
  });

  it('assina claims curtos que restringem o PostgREST ao tenant e ao papel authenticated', () => {
    const token = createTenantRuntimeAccessToken(config, {
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      role: 'manager',
      source: 'authenticated_request',
    });
    const payload = jwt.verify(token, RUNTIME_SECRET) as jwt.JwtPayload;

    expect(payload.tenant_id).toBe(TENANT_A);
    expect(payload.sub).toBe(ACTOR_A);
    expect(payload.role).toBe('authenticated');
    expect(payload.aud).toBe('authenticated');
    expect(payload.app_role).toBe('manager');
    expect(payload.exp).toBeGreaterThan(payload.iat || 0);
  });
});
