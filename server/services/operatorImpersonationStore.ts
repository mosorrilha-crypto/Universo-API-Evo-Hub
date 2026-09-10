/**
 * Log append-only de impersonação (saas_admin "acessa como" um operador
 * específico dentro de um tenant) — ver
 * supabase/migrations/0081_operator_impersonation_events.sql.
 *
 * Diferente de contactJourneyStore.ts (best-effort, nunca bloqueia o
 * caminho principal), uma falha ao gravar AQUI bloqueia a troca de sessão
 * — impersonação é sensível o bastante pra nunca acontecer sem deixar
 * rastro auditável. Por isso recebe o client diretamente (mesmo padrão já
 * usado em server/routes/admin.ts, que não passa por getDb()/tenant
 * context — essas rotas já são saas_admin-only, cross-tenant por design).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ImpersonationEventType = 'started' | 'ended';

export interface RecordImpersonationEventInput {
  tenantId: string;
  targetOperatorId: string;
  actorId: string;
  eventType: ImpersonationEventType;
  reason?: string;
}

export async function recordOperatorImpersonationEvent(db: SupabaseClient, input: RecordImpersonationEventInput): Promise<void> {
  const { error } = await db.from('operator_impersonation_events').insert({
    tenant_id: input.tenantId,
    target_operator_id: input.targetOperatorId,
    actor_id: input.actorId,
    event_type: input.eventType,
    reason: input.reason || null,
  });
  if (error) throw error;
}
