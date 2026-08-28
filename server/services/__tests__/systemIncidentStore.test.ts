import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { archiveSystemIncident, listSystemIncidents, reportSystemIncident, resolveSystemIncident, restoreSystemIncident, reviewSystemIncident } from '../systemIncidentStore';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('systemIncidentStore', () => {
  let db: ReturnType<typeof createFakeSupabase>;

  beforeEach(() => {
    db = createFakeSupabase({});
    initDb(db as any);
  });

  it('deduplica uma recorrência aberta por tenant e mantém trilha de auditoria', async () => {
    const input = { tenantId: TENANT_A, sourceKey: 'system:knowledgeBase:loadRuntimeSource:legacy-fallback', category: 'knowledge_base' as const, severity: 'high' as const, title: 'Fallback técnico', detail: 'source=legacy_blob', suggestedAction: 'Revisar documentos publicados.' };
    await reportSystemIncident(input);
    const repeated = await reportSystemIncident(input);

    expect((db.__tables.system_incidents || [])).toHaveLength(1);
    expect(repeated.occurrenceCount).toBe(2);
    expect((db.__tables.system_incident_audit_events || []).map((event) => event.event_type)).toEqual(['created', 'recurred']);
  });

  it('nunca mistura o mesmo sinal entre tenants', async () => {
    const input = { sourceKey: 'system:catalog:load:error', category: 'catalog' as const, severity: 'medium' as const, title: 'Falha no catálogo', suggestedAction: 'Revisar configuração.' };
    await reportSystemIncident({ ...input, tenantId: TENANT_A });
    await reportSystemIncident({ ...input, tenantId: TENANT_B });

    expect(await listSystemIncidents(TENANT_A)).toHaveLength(1);
    expect(await listSystemIncidents(TENANT_B)).toHaveLength(1);
  });

  it('registra revisão, resolução, arquivamento e restauração sem executar correção alguma', async () => {
    const created = await reportSystemIncident({ tenantId: TENANT_A, sourceKey: 'system:runtime:sync:error', category: 'runtime', severity: 'medium', title: 'Falha de sincronização', suggestedAction: 'Revisar a integração.' });
    expect((await reviewSystemIncident(TENANT_A, created.id, { id: 'admin-1' }) as any)?.status).toBe('reviewed');
    expect((await resolveSystemIncident(TENANT_A, created.id, { id: 'admin-1' }, 'Conferido manualmente.') as any)?.status).toBe('resolved');
    expect((await archiveSystemIncident(TENANT_A, created.id, { id: 'admin-1' }) as any)?.status).toBe('archived');
    expect((await restoreSystemIncident(TENANT_A, created.id, { id: 'admin-1' }) as any)?.status).toBe('open');
    expect((db.__tables.system_incident_audit_events || []).map((event) => event.event_type)).toEqual(['created', 'reviewed', 'resolved', 'archived', 'restored']);
  });
});
