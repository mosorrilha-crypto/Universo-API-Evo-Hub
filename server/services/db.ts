/**
 * Cliente Postgres compartilhado pelos 8 serviços migrados pra tabelas reais
 * (Bloco 2.A). Reaproveita a MESMA instância de SupabaseClient criada em
 * server.ts (server/supabaseClient.ts) — evita abrir uma segunda conexão
 * pro mesmo projeto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function initDb(supabase: SupabaseClient | null) {
  client = supabase;
}

/** Lança se o Supabase não estiver configurado — nenhum dos 8 serviços tem fallback em memória mais, dado real precisa de banco real. */
export function getDb(): SupabaseClient {
  if (!client) {
    throw new Error('Banco de dados não configurado — defina SUPABASE_URL e SUPABASE_KEY no ambiente.');
  }
  return client;
}
