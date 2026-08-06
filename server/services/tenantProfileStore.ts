/**
 * Metadados de tenant que definem qual conteúdo fixo de camada usar no
 * prompt do agente — hoje só `segment` (camada 2, ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1). Separado de
 * knowledgeBaseStore.ts porque é dado do tenant em si (tabela `tenants`),
 * não a base de conhecimento editável (camada 3).
 */
import { getDb } from './db';

export const DEFAULT_SEGMENT = 'beauty_studio';

export async function getTenantSegment(tenantId: string): Promise<string> {
  const db = getDb();
  const { data } = await db.from('tenants').select('segment').eq('id', tenantId).maybeSingle();
  return (data?.segment as string | undefined) || DEFAULT_SEGMENT;
}
