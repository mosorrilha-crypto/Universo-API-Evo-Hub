/**
 * Escalonamento pra atendimento humano — "isso precisa de você". Sem isso,
 * se o agente automático não souber responder (ou o envio falhar), a
 * conversa simplesmente fica parada sem avisar ninguém. Migrado pra tabela
 * Postgres `escalations` (Bloco 2.A), particionada por tenant_id.
 *
 * Ordena com prioridade pra contatos do Paraguai primeiro (preferência de
 * negócio atual), depois não-resolvidos, depois mais recentes.
 */
import { getDb } from './db';
import { inferCountryFromPhone } from './conversationStore';
import { notifyEscalationCreated } from './escalationAlertService';

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

type EscalationRow = {
  id: string;
  phone: string;
  contact_name: string | null;
  reason: string;
  last_message: string | null;
  country: string | null;
  resolved: boolean;
  created_at: string;
};

function toEscalation(row: EscalationRow): Escalation {
  return {
    id: row.id,
    phone: row.phone,
    contactName: row.contact_name || undefined,
    reason: row.reason,
    lastMessage: row.last_message || undefined,
    country: row.country || 'Desconhecido',
    resolved: row.resolved,
    createdAt: row.created_at,
  };
}

/**
 * Detecta se uma mensagem provavelmente se refere a confirmação de pagamento
 * — nunca deixar o agente confirmar isso sozinho. Cobre espanhol paraguaio
 * (idioma principal do atendimento) E português (parte da clientela da
 * Monique é brasileira — "comprovante"/"transferência" não seriam
 * detectados só com a grafia em espanhol).
 */
export function isPaymentRelated(text: string): boolean {
  return /\b(pago|pagu[eé]i|se[ñn]a|transfer[êe]nc[ií]a|transferir|comprobante|comprovante|dep[oó]sit(o|ei))\b/i.test(text || '');
}

export async function logEscalation(tenantId: string, phone: string, contactName: string | undefined, reason: string, lastMessage?: string): Promise<Escalation> {
  const db = getDb();
  const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Gravado explicitamente (em vez de depender só do default now() do
  // Postgres): listEscalations ordena por created_at, e mais de um
  // escalonamento no mesmo tenant sem esse valor quebra o sort.
  const createdAt = new Date().toISOString();
  const row = {
    id,
    tenant_id: tenantId,
    phone,
    contact_name: contactName || null,
    reason,
    last_message: lastMessage || null,
    country: inferCountryFromPhone(phone),
    resolved: false,
    created_at: createdAt,
  };
  const { error } = await db.from('escalations').insert(row);
  if (error) throw error;
  console.log(`🚨 [Escalonamento] tenant=${tenantId} ${phone} (${row.country}): ${reason}`);
  // Nunca bloqueia nem derruba o registro da escalação (que é o que importa
  // de verdade) por causa do alerta — mesmo padrão de notifyMetaCapiEvent.
  notifyEscalationCreated(tenantId, { phone, contactName, reason }).catch((err) =>
    console.warn(`⚠️  [Alerta de escalonamento] tenant=${tenantId} falha ao notificar:`, (err as Error).message)
  );
  return toEscalation(row);
}

export async function listEscalations(tenantId: string): Promise<Escalation[]> {
  const db = getDb();
  const { data, error } = await db
    .from('escalations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('resolved', { ascending: true })
    .order('country', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  // country asc coloca "Paraguay" antes de outros alfabeticamente por acaso,
  // não por garantia — reordena explicitamente pra manter a prioridade real.
  return (data as EscalationRow[])
    .map(toEscalation)
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      const aPy = a.country === 'Paraguay' ? 0 : 1;
      const bPy = b.country === 'Paraguay' ? 0 : 1;
      if (aPy !== bPy) return aPy - bPy;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export async function resolveEscalation(tenantId: string, id: string): Promise<Escalation | undefined> {
  const db = getDb();
  const { data, error } = await db.from('escalations').update({ resolved: true }).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? toEscalation(data as EscalationRow) : undefined;
}

export async function deleteEscalation(tenantId: string, id: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from('escalations').delete().eq('tenant_id', tenantId).eq('id', id).select('id');
  if (error) throw error;
  return !!data?.length;
}
