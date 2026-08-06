/**
 * Respostas rápidas configuráveis — lista única de mensagens prontas
 * compartilhada pela equipe, pro operador inserir com um clique no painel.
 * Migrado pra tabela Postgres `quick_replies` (Bloco 2.A), 1 registro
 * (jsonb) por tenant_id.
 */
import { getDb } from './db';

export async function getQuickReplies(tenantId: string): Promise<string[]> {
  const db = getDb();
  const { data } = await db.from('quick_replies').select('list').eq('tenant_id', tenantId).maybeSingle();
  return (data?.list as string[] | undefined) || [];
}

export async function setQuickReplies(tenantId: string, list: string[]): Promise<void> {
  const db = getDb();
  const { error } = await db.from('quick_replies').upsert({ tenant_id: tenantId, list }, { onConflict: 'tenant_id' });
  if (error) throw error;
}
