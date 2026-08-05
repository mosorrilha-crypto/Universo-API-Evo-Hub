/**
 * Escalonamento pra atendimento humano — "isso precisa de você", inspirado
 * no lib/storage.js do whatsapp-agent-monique (logEscalation/listEscalations).
 * Sem isso, se o agente automático não souber responder (ou o envio falhar),
 * a conversa simplesmente fica parada sem avisar ninguém.
 *
 * Ordena com prioridade pra contatos do Paraguai primeiro (preferência de
 * negócio atual), depois não-resolvidos, depois mais recentes.
 */
import { inferCountryFromPhone } from './conversationStore';

export interface Escalation {
  id: string;
  phone: string;
  contactName?: string;
  reason: string;
  lastMessage?: string;
  country: string;
  resolved: boolean;
  createdAt: string;
}

const BUCKET = 'app-data';
const OBJECT_PATH = 'escalations.json';

const escalations = new Map<string, Escalation>();
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function initEscalationPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as Escalation[];
      for (const e of data) escalations.set(e.id, e);
      console.log(`💾 [Escalonamentos] ${data.length} restaurado(s) do Supabase Storage.`);
    }
  } catch (err) {
    console.warn('⚠️  [Escalonamentos] Falha ao carregar:', (err as Error).message);
  }
}

function scheduleSave() {
  if (!persistence) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(`${persistence!.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
        method: 'POST',
        headers: {
          apikey: persistence!.supabaseKey,
          Authorization: `Bearer ${persistence!.supabaseKey}`,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(Array.from(escalations.values())),
      });
    } catch (err) {
      console.warn('⚠️  [Escalonamentos] Falha ao salvar:', (err as Error).message);
    }
  }, 2000);
}

/** Detecta se uma mensagem provavelmente se refere a confirmação de pagamento — nunca deixar o agente confirmar isso sozinho. */
export function isPaymentRelated(text: string): boolean {
  return /\b(pago|se[ñn]a|transferencia|transferir|comprobante|deposito|dep[oó]sito)\b/i.test(text || '');
}

export function logEscalation(phone: string, contactName: string | undefined, reason: string, lastMessage?: string): Escalation {
  const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: Escalation = {
    id,
    phone,
    contactName,
    reason,
    lastMessage,
    country: inferCountryFromPhone(phone),
    resolved: false,
    createdAt: new Date().toISOString(),
  };
  escalations.set(id, entry);
  scheduleSave();
  console.log(`🚨 [Escalonamento] ${phone} (${entry.country}): ${reason}`);
  return entry;
}

export function listEscalations(): Escalation[] {
  return Array.from(escalations.values()).sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    const aPy = a.country === 'Paraguay' ? 0 : 1;
    const bPy = b.country === 'Paraguay' ? 0 : 1;
    if (aPy !== bPy) return aPy - bPy;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function resolveEscalation(id: string): Escalation | undefined {
  const e = escalations.get(id);
  if (!e) return undefined;
  e.resolved = true;
  scheduleSave();
  return e;
}

export function deleteEscalation(id: string): boolean {
  const existed = escalations.delete(id);
  if (existed) scheduleSave();
  return existed;
}
