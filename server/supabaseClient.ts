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

  // Achado numa auditoria externa: esse aviso dizia que as rotas "usarão
  // dados de demonstração ou retornarão aviso" — não existe mais fallback de
  // demonstração em nenhum serviço; getDb() (server/services/db.ts) lança
  // exceção quando não há client configurado, o que vira 500 nas rotas que
  // dependem dele. Quem for debugar um 500 em produção não deve ser
  // enganado por esse comentário/log.
  console.warn('⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados ou inválidos nas variáveis de ambiente. Toda rota que depender do banco vai falhar com erro (getDb() lança exceção) até isso ser configurado.');
  return null;
}
