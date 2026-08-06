/**
 * Controle de status do agente automático (3 estados): "active" (responde
 * sempre), "paused" (silêncio total, operador assume manualmente),
 * "restricted" (só responde fora do horário comercial). Migrado pra tabela
 * Postgres `agent_status` (Bloco 2.A), 1 registro por tenant_id.
 */
import { getDb } from './db';

export type AgentStatus = 'active' | 'paused' | 'restricted';

const TIMEZONE = 'America/Asuncion';

export async function getAgentStatus(tenantId: string): Promise<AgentStatus> {
  const db = getDb();
  const { data } = await db.from('agent_status').select('status').eq('tenant_id', tenantId).maybeSingle();
  return (data?.status as AgentStatus | undefined) || 'active';
}

export async function setAgentStatus(tenantId: string, status: AgentStatus): Promise<void> {
  if (!['active', 'paused', 'restricted'].includes(status)) {
    throw new Error(`Status inválido: ${status}`);
  }
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .upsert({ tenant_id: tenantId, status, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** true = não deve responder automaticamente agora. */
export async function isAgentPaused(tenantId: string): Promise<boolean> {
  const status = await getAgentStatus(tenantId);
  if (status === 'paused') return true;
  if (status === 'restricted') {
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: TIMEZONE, hour: '2-digit', hour12: false }));
    return hour >= 8 && hour < 20; // silêncio 08:00–19:59, só responde à noite/madrugada
  }
  return false;
}
