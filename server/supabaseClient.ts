import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import type { ServerConfig } from './config';
import type { TenantDbContext } from './services/tenantDbContext';

const RUNTIME_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * Cliente de plataforma. A chave usada aqui possui privilégios administrativos
 * e pode ignorar RLS; portanto, só é apropriada para operações explicitamente
 * cross-tenant, resolução de canais e manutenção.
 */
export function createSupabaseClientFromConfig(config: ServerConfig): SupabaseClient | null {
  const { supabaseUrl, supabaseKey } = config;

  if (supabaseUrl && supabaseKey && /^https?:\/\//i.test(supabaseUrl.trim())) {
    try {
      return createClient(supabaseUrl.trim(), supabaseKey.trim(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    } catch (err) {
      console.warn('⚠️ Falha ao inicializar cliente Supabase de plataforma:', err);
      return null;
    }
  }

  console.warn('⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados ou inválidos nas variáveis de ambiente. Toda rota que depender do banco vai falhar até isso ser configurado.');
  return null;
}

/**
 * Emite um JWT curto destinado exclusivamente ao PostgREST. O token não é
 * exposto ao navegador: ele carrega o tenant já validado pelo backend e faz
 * com que as policies consultem `auth.jwt()->>'tenant_id'` em vez de confiar
 * em filtros opcionais da aplicação.
 */
export function createTenantRuntimeAccessToken(config: ServerConfig, context: TenantDbContext): string {
  if (!config.supabaseJwtSecret) {
    throw new Error('SUPABASE_JWT_SECRET ausente — não é possível abrir contexto RLS de tenant.');
  }
  if (!context.tenantId) {
    throw new Error('tenantId ausente — JWT de runtime recusado.');
  }

  return jwt.sign(
    {
      aud: 'authenticated',
      role: 'authenticated',
      tenant_id: context.tenantId,
      app_role: context.role || 'system',
      source: context.source,
    },
    config.supabaseJwtSecret,
    {
      algorithm: 'HS256',
      subject: context.actorId || `tenant-runtime:${context.tenantId}`,
      expiresIn: RUNTIME_TOKEN_TTL_SECONDS,
    }
  );
}

/**
 * Cliente restrito para uma única execução tenant-scoped. A chave pública
 * identifica o projeto; o Bearer JWT contém o tenant validado e é avaliado
 * pelo PostgREST/RLS. Nunca substitua a chave pública por SUPABASE_KEY aqui.
 */
export function createTenantScopedSupabaseClient(config: ServerConfig, context: TenantDbContext): SupabaseClient {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY ausente — cliente RLS indisponível.');
  }

  const accessToken = createTenantRuntimeAccessToken(config, context);
  return createClient(config.supabaseUrl.trim(), config.supabasePublishableKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
