/**
 * [CRM] Conecta o OperatorCRM aos leads reais — estado de CRM por lead
 * (estágio/notas/tarefas/valor), ver supabase/migrations/0013_crm_lead_state.sql.
 * Segue o padrão de tenantIsolation.test.ts: fake Supabase em memória via
 * initDb(createFakeSupabase()).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { listCrmLeadStates, upsertCrmLeadState, deleteCrmLeadState } from '../crmStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('crmStore — estado de CRM por lead', () => {
  it('upsertCrmLeadState cria a linha na primeira interação real do operador', async () => {
    const state = await upsertCrmLeadState(TENANT_A, '595981111111', { stage: 'contato' });
    expect(state.stage).toBe('contato');
    expect(state.notes).toEqual([]);
    expect(state.tasks).toEqual([]);

    const [listed] = await listCrmLeadStates(TENANT_A);
    expect(listed.phone).toBe('595981111111');
    expect(listed.stage).toBe('contato');
  });

  it('upsertCrmLeadState atualiza só os campos enviados, preservando o resto', async () => {
    await upsertCrmLeadState(TENANT_A, '595981111111', { stage: 'contato', dealValue: 1000 });
    const updated = await upsertCrmLeadState(TENANT_A, '595981111111', { stage: 'proposta' });

    expect(updated.stage).toBe('proposta');
    expect(updated.dealValue).toBe(1000); // preservado, não foi enviado de novo

    const all = await listCrmLeadStates(TENANT_A);
    expect(all).toHaveLength(1); // upsert, não duplica linha
  });

  it('notes/tasks são substituídos por inteiro quando enviados (o cliente já manda o array completo)', async () => {
    const note = { id: 'n1', authorName: 'Ana', text: 'Ligar amanhã', createdAt: new Date().toISOString() };
    const state = await upsertCrmLeadState(TENANT_A, '595981111111', { notes: [note] });
    expect(state.notes).toEqual([note]);

    const note2 = { id: 'n2', authorName: 'Ana', text: 'Enviou comprovante', createdAt: new Date().toISOString() };
    const updated = await upsertCrmLeadState(TENANT_A, '595981111111', { notes: [note, note2] });
    expect(updated.notes).toHaveLength(2);
  });

  it('isolamento: tenant B nunca vê o estado de CRM do tenant A', async () => {
    await upsertCrmLeadState(TENANT_A, '595981111111', { stage: 'ganho' });
    const listB = await listCrmLeadStates(TENANT_B);
    expect(listB).toHaveLength(0);
  });

  it('deleteCrmLeadState remove o registro, sem afetar outro tenant', async () => {
    await upsertCrmLeadState(TENANT_A, '595981111111', { stage: 'ganho' });
    await deleteCrmLeadState(TENANT_A, '595981111111');
    expect(await listCrmLeadStates(TENANT_A)).toHaveLength(0);
  });

  it('name/email só valem pra lead cadastrado manualmente, antes de ter conversa real', async () => {
    const state = await upsertCrmLeadState(TENANT_A, '595982222222', { name: 'Claudia', email: 'claudia@exemplo.com' });
    expect(state.name).toBe('Claudia');
    expect(state.email).toBe('claudia@exemplo.com');
  });
});
