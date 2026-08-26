import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from '../config';
import { createTenantScopedSupabaseClient } from '../supabaseClient';
import { getTenantDbContext } from './tenantDbContext';

/** Cliente administrativo: só para fluxos de plataforma deliberadamente cross-tenant. */
let platformClient: SupabaseClient | null = null;
let runtimeConfig: ServerConfig | null = null;

/**
 * Inicializa a camada de dados. Em produção, `config.rlsEnforced` é verdadeiro
 * somente quando existem a chave pública e o segredo de assinatura usados
 * pelo cliente tenant-scoped. Testes podem omitir a configuração e injetar um
 * fake local de Supabase.
 */
export function initDb(supabase: SupabaseClient | null, config?: ServerConfig): void {
  platformClient = supabase;
  runtimeConfig = config || null;
}

/**
 * Acesso de aplicação. Quando o RLS está configurado, toda operação exige um
 * contexto tenant-scoped e usa uma chave pública + JWT curto com `tenant_id`.
 * Isso impede que uma nova rota acesse dados sem o banco aplicar a policy.
 */
export function getDb(): SupabaseClient {
  if (!platformClient) {
    throw new Error('Banco de dados não configurado — defina SUPABASE_URL e SUPABASE_KEY no ambiente.');
  }

  const context = getTenantDbContext();
  if (runtimeConfig?.rlsEnforced) {
    if (!context) {
      throw new Error('Acesso ao banco sem contexto de tenant — recusado para preservar RLS. Use getPlatformDb() somente em fluxo cross-tenant autorizado.');
    }
    return createTenantScopedSupabaseClient(runtimeConfig, context);
  }

  // Desenvolvimento e testes legados: mantém o fake de banco utilizável. O
  // servidor de produção não inicia sem RLS configurado (ver config.ts).
  return platformClient;
}

/**
 * Escape hatch explícito para operações que precisam enxergar múltiplos
 * tenants: administração de plataforma, resolução de canal, jobs globais e
 * catálogo público por slug. Nunca use em uma rota autenticada de tenant.
 */
export function getPlatformDb(): SupabaseClient {
  if (!platformClient) {
    throw new Error('Banco de dados de plataforma não configurado — defina SUPABASE_URL e SUPABASE_KEY no ambiente.');
  }
  return platformClient;
}
