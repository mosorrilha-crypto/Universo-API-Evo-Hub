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

/**
 * Modo "somente anúncios" (pedido real, 14/08/2026): quando o tenant tem
 * mais de um número de WhatsApp ligado (ex: o pessoal do dono do negócio,
 * conectado temporariamente pra não perder mensagem, e o número dedicado
 * do agente), ativar isso faz o agente só responder automaticamente
 * contatos identificados como vindos de anúncio (ctwa_clid gravado na
 * conversa, ver conversationStore.ts) — nunca contatos pessoais. Flag
 * ortogonal ao status active/paused/restricted, não um 4º valor dele; quem
 * chama combina isAdsOnlyMode() com o ctwa_clid da conversa (ver
 * webhooks.ts/transcriptionQueue.ts). A mensagem em si continua sendo
 * gravada normalmente — só a resposta automática fica em silêncio.
 */
export async function isAdsOnlyMode(tenantId: string): Promise<boolean> {
  const db = getDb();
  const { data } = await db.from('agent_status').select('ads_only').eq('tenant_id', tenantId).maybeSingle();
  return !!data?.ads_only;
}

export async function setAdsOnlyMode(tenantId: string, adsOnly: boolean): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .upsert({ tenant_id: tenantId, ads_only: adsOnly, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}
