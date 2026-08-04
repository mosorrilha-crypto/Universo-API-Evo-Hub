import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from './config';

export function createSupabaseClientFromConfig(config: ServerConfig): SupabaseClient | null {
  const { supabaseUrl, supabaseKey } = config;

  if (supabaseUrl && supabaseKey && /^https?:\/\//i.test(supabaseUrl.trim())) {
    try {
      return createClient(supabaseUrl.trim(), supabaseKey.trim());
    } catch (err) {
      console.warn('⚠️ Falha ao inicializar cliente Supabase:', err);
      return null;
    }
  }

  console.warn('⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados ou inválidos nas variáveis de ambiente. As rotas de banco de dados usarão dados de demonstração ou retornarão aviso ao serem invocadas.');
  return null;
}
