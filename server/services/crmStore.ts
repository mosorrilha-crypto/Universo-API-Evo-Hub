/**
 * Estado de CRM por lead (estágio do funil, valor do negócio, operador
 * responsável, notas, tarefas) — ver supabase/migrations/0013_crm_lead_state.sql
 * pro raciocínio completo de design (achado real: OperatorCRM.tsx era 100%
 * mock/localStorage, leads reais nunca apareciam lá).
 */
import { getDb } from './db';

export interface CrmNote {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CrmTask {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  assignedOperator: string;
}

export interface CrmLeadState {
  phone: string;
  name?: string;
  email?: string;
  stage: string;
  dealValue?: number;
  assignedOperator?: string;
  notes: CrmNote[];
  tasks: CrmTask[];
  updatedAt: string;
}

type CrmLeadStateRow = {
  phone: string;
  name: string | null;
  email: string | null;
  stage: string;
  deal_value: number | null;
  assigned_operator: string | null;
  notes: CrmNote[] | null;
  tasks: CrmTask[] | null;
  updated_at: string;
};

const CRM_LEAD_STATE_COLUMNS = 'phone, name, email, stage, deal_value, assigned_operator, notes, tasks, updated_at';

function toCrmLeadState(row: CrmLeadStateRow): CrmLeadState {
  return {
    phone: row.phone,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    stage: row.stage,
    dealValue: row.deal_value ?? undefined,
    assignedOperator: row.assigned_operator ?? undefined,
    notes: row.notes || [],
    tasks: row.tasks || [],
    updatedAt: row.updated_at,
  };
}

/** Todas as linhas de CRM já registradas pro tenant — só leads em que um operador já interagiu de verdade (mudou estágio, notou algo, criou tarefa ou definiu valor), ou cadastrou manualmente. */
export async function listCrmLeadStates(tenantId: string): Promise<CrmLeadState[]> {
  const db = getDb();
  const { data, error } = await db
    .from('crm_lead_state')
    .select(CRM_LEAD_STATE_COLUMNS)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return (data as CrmLeadStateRow[]).map(toCrmLeadState);
}

export interface CrmLeadStatePatch {
  name?: string;
  email?: string;
  stage?: string;
  dealValue?: number | null;
  assignedOperator?: string | null;
  notes?: CrmNote[];
  tasks?: CrmTask[];
}

/**
 * Upsert de verdade (cria se não existir, atualiza se existir) — diferente
 * de updateConversationState (que exige a conversa já existir), porque um
 * lead de CRM pode ser cadastrado manualmente ("+ Novo Lead Real") antes de
 * qualquer conversa real acontecer nesse telefone.
 */
export async function upsertCrmLeadState(tenantId: string, phone: string, patch: CrmLeadStatePatch): Promise<CrmLeadState> {
  const db = getDb();
  const update: Record<string, any> = { tenant_id: tenantId, phone, updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.email !== undefined) update.email = patch.email;
  if (patch.stage !== undefined) update.stage = patch.stage;
  if (patch.dealValue !== undefined) update.deal_value = patch.dealValue;
  if (patch.assignedOperator !== undefined) update.assigned_operator = patch.assignedOperator;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.tasks !== undefined) update.tasks = patch.tasks;

  const { data, error } = await db
    .from('crm_lead_state')
    .upsert(update, { onConflict: 'tenant_id,phone' })
    .select(CRM_LEAD_STATE_COLUMNS)
    .single();
  if (error) throw error;
  return toCrmLeadState(data as CrmLeadStateRow);
}

/** Remove o estado de CRM de um lead (não apaga a conversa/mensagens — só a organização do funil). */
export async function deleteCrmLeadState(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('crm_lead_state').delete().eq('tenant_id', tenantId).eq('phone', phone);
  if (error) throw error;
}
