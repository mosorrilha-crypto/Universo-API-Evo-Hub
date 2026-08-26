/**
 * Acompanhamento de funil — ver migration 0034_pending_followups.sql pro
 * contexto completo. Duas situações rastreadas (`PendingFollowUpKind`):
 * 'owner_review' (esperando avaliação da dona do negócio, ex: foto de
 * trabalho anterior) e 'customer_reply' (IA ofereceu algo e o cliente
 * sumiu). Nunca reabre contato sozinho — server/services/pendingFollowUpJob.ts
 * é quem escala pro operador humano via Escalonamentos quando vence.
 */
import { getDb, getPlatformDb } from './db';

export type PendingFollowUpKind = 'owner_review' | 'customer_reply';

export interface PendingFollowUp {
  id: string;
  tenantId: string;
  phone: string;
  contactName?: string;
  kind: PendingFollowUpKind;
  reason: string;
  dueAt: string;
  createdAt: string;
  followupAlertedAt?: string;
}

type PendingFollowUpRow = {
  id: string;
  tenant_id: string;
  phone: string;
  contact_name: string | null;
  kind: PendingFollowUpKind;
  reason: string;
  due_at: string;
  created_at: string;
  followup_alerted_at: string | null;
};

function toPendingFollowUp(row: PendingFollowUpRow): PendingFollowUp {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    phone: row.phone,
    contactName: row.contact_name || undefined,
    kind: row.kind,
    reason: row.reason,
    dueAt: row.due_at,
    createdAt: row.created_at,
    followupAlertedAt: row.followup_alerted_at || undefined,
  };
}

/**
 * Registra um novo acompanhamento pendente — idempotente por (tenant, phone,
 * kind): se já existe um não-alertado pra esse par, não duplica (evita spam
 * de escalonamento se a IA sinalizar a mesma situação em turnos seguidos),
 * só atualiza reason/dueAt pro mais recente.
 */
export async function markPendingFollowUp(
  tenantId: string,
  phone: string,
  contactName: string | undefined,
  kind: PendingFollowUpKind,
  reason: string,
  dueAt: string
): Promise<void> {
  const db = getDb();
  const { data: existing } = await db
    .from('pending_followups')
    .select('id, followup_alerted_at')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('kind', kind);
  const openRow = ((existing as { id: string; followup_alerted_at: string | null }[] | null) || []).find((r) => !r.followup_alerted_at);
  if (openRow) {
    const { error } = await db.from('pending_followups').update({ reason, due_at: dueAt, contact_name: contactName || null }).eq('id', openRow.id);
    if (error) throw error;
    return;
  }
  const { error } = await db.from('pending_followups').insert({
    tenant_id: tenantId,
    phone,
    contact_name: contactName || null,
    kind,
    reason,
    due_at: dueAt,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Cancela acompanhamento(s) pendente(s) — usado quando o cliente responde de
 * novo (kind 'customer_reply' não faz mais sentido, ele não sumiu). Só
 * cancela registros AINDA não alertados — um que já virou escalonamento real
 * fica por conta do fluxo normal de Escalonamentos (resolver/descartar lá).
 */
export async function clearPendingFollowUp(tenantId: string, phone: string, kind: PendingFollowUpKind): Promise<void> {
  const db = getDb();
  const { data } = await db
    .from('pending_followups')
    .select('id, followup_alerted_at')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('kind', kind);
  const openIds = ((data as { id: string; followup_alerted_at: string | null }[] | null) || [])
    .filter((r) => !r.followup_alerted_at)
    .map((r) => r.id);
  for (const id of openIds) {
    await db.from('pending_followups').delete().eq('id', id);
  }
}

/** Todo tenant com pelo menos um acompanhamento ainda não alertado — pro job iterar sem varrer tenant por tenant à toa. */
export async function listTenantIdsWithPendingFollowUps(): Promise<string[]> {
  const db = getPlatformDb();
  const { data, error } = await db.from('pending_followups').select('tenant_id');
  if (error) throw error;
  const ids = ((data as { tenant_id: string }[] | null) || []).map((r) => r.tenant_id);
  return [...new Set(ids)];
}

/** Acompanhamentos pendentes (não alertados) de um tenant, mais recentes primeiro. */
export async function listPendingFollowUps(tenantId: string): Promise<PendingFollowUp[]> {
  const db = getDb();
  const { data, error } = await db.from('pending_followups').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return ((data as PendingFollowUpRow[]) || [])
    .map(toPendingFollowUp)
    .filter((p) => !p.followupAlertedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markFollowUpAlerted(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('pending_followups')
    .update({ followup_alerted_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id);
  if (error) throw error;
}
