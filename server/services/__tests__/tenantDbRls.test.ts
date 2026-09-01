import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from '../../config';
import { createTenantRuntimeAccessToken } from '../../supabaseClient';
import { getDb, getPlatformDb, initDb } from '../db';
import { disableTenantDbContextForTests, runWithTenantDbContext } from '../tenantDbContext';
import { createFakeSupabase } from './fakeSupabase';
import { setTenantBusinessHours } from '../tenantProfileStore';

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

  it('permite que o callback público do OAuth do Google Calendar (sem JWT autenticado) grave o refresh token via runWithTenantDbContext com source "webhook"', async () => {
    // TASK-0187 — achado real em produção (01/09/2026, tenant Monique): a
    // rota GET /api/google-calendar/oauth-callback é pública (sem
    // authenticateToken, porque o Google redireciona o navegador direto pra
    // ela) — nunca passava pelo TenantDbContext do AsyncLocalStorage, então
    // handleGoogleOAuthCallback (que chama getDb() em saveRefreshToken)
    // sempre rejeitava com "sem contexto de tenant", bloqueando toda
    // reconexão/primeira conexão do Google Calendar desde o rollout de RLS
    // (TASK-0083) sem que ninguém percebesse até reconectar de novo. O
    // tenantId já vem verificado do state assinado (verifyOAuthState) antes
    // de chegar aqui, então roda como 'webhook' (mesmo padrão dos webhooks
    // do WhatsApp em tenantResolver.ts).
    expect(() => getDb()).toThrow(/sem contexto de tenant/i);
    await runWithTenantDbContext({ tenantId: TENANT_A, source: 'webhook' }, async () => {
      await Promise.resolve();
      expect(getDb()).not.toBe(platformClient);
    });
  });

  it('TASK-0187 (parte 2): setTenantBusinessHours persiste de verdade mesmo sem contexto de tenant do AsyncLocalStorage (getPlatformDb, nunca getDb)', async () => {
    // Achado real relatado ao vivo (01/09/2026): salvar horário de
    // atendimento nunca dava erro (a rota GET/POST /api/business-hours é
    // autenticada normalmente), mas nunca persistia — ao reabrir, voltava
    // vazio. Causa confirmada via `pg_policies` real: a tabela `tenants` só
    // tem policy de SELECT pro papel `authenticated`, nenhuma de UPDATE.
    // setTenantBusinessHours usava getDb() (cliente tenant-scoped sob RLS)
    // — o UPDATE nunca dava erro, mas afetava zero linhas silenciosamente
    // (comportamento padrão do Postgres/PostgREST sem policy que autorize).
    // Fix: getPlatformDb(), que nem verifica TenantDbContext — este teste
    // prova isso rodando SEM nenhum runWithTenantDbContext ativo (cenário
    // que reproduziria o "sem contexto de tenant" se ainda usasse getDb()).
    const fakeSupabase = createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Studio X' }] });
    initDb(fakeSupabase, config);
    disableTenantDbContextForTests();

    await expect(setTenantBusinessHours(TENANT_A, { '1': { open: '09:00', close: '18:00' } })).resolves.not.toThrow();

    // Confere a persistência direto pelo mesmo cliente de plataforma usado
    // por getPlatformDb() (getDb(), sob rlsEnforced, criaria um client real
    // apontando pra https://example.supabase.co — fora do alcance deste
    // teste unitário; ver getTenantBusinessHours coberto separadamente sem
    // RLS em outros testes do projeto).
    const { data } = await getPlatformDb().from('tenants').select('business_hours').eq('id', TENANT_A).maybeSingle();
    expect(data?.business_hours).toEqual({ '1': { open: '09:00', close: '18:00' } });
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
