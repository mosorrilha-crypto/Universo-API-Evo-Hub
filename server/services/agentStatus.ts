/**
 * Controle de status do agente automático (3 estados, inspirado no
 * whatsapp-agent-monique): "active" (responde sempre), "paused" (silêncio
 * total, operador assume manualmente), "restricted" (só responde fora do
 * horário comercial). Persiste no mesmo Supabase Storage usado pelas
 * conversas (server/services/conversationStore.ts), pra sobreviver a
 * redeploys.
 */

export type AgentStatus = 'active' | 'paused' | 'restricted';

const TIMEZONE = 'America/Asuncion';
const BUCKET = 'app-data';
const OBJECT_PATH = 'agent-status.json';

let currentStatus: AgentStatus = 'active';
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;

export async function initAgentStatusPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };

  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { status?: AgentStatus };
      if (data.status) currentStatus = data.status;
    }
  } catch (err) {
    console.warn('⚠️  [Agente] Falha ao carregar status persistido:', (err as Error).message);
  }
}

async function persist() {
  if (!persistence) return;
  try {
    await fetch(`${persistence.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'POST',
      headers: {
        apikey: persistence.supabaseKey,
        Authorization: `Bearer ${persistence.supabaseKey}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify({ status: currentStatus }),
    });
  } catch (err) {
    console.warn('⚠️  [Agente] Falha ao salvar status:', (err as Error).message);
  }
}

export function getAgentStatus(): AgentStatus {
  return currentStatus;
}

export function setAgentStatus(status: AgentStatus) {
  if (!['active', 'paused', 'restricted'].includes(status)) {
    throw new Error(`Status inválido: ${status}`);
  }
  currentStatus = status;
  void persist();
}

/** true = não deve responder automaticamente agora. */
export function isAgentPaused(): boolean {
  if (currentStatus === 'paused') return true;
  if (currentStatus === 'restricted') {
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: TIMEZONE, hour: '2-digit', hour12: false }));
    return hour >= 8 && hour < 20; // silêncio 08:00–19:59, só responde à noite/madrugada
  }
  return false;
}
