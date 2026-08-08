/**
 * Etiquetas livres por conversa (addLabel/removeLabel/listLabels em
 * conversationLabelStore.ts). Segue o padrão de tenantIsolation.test.ts:
 * fake Supabase em memória via initDb(createFakeSupabase()).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage } from '../conversationStore';
import { addLabel, removeLabel, listLabels, listAllTenantLabels } from '../conversationLabelStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('etiquetas livres por conversa', () => {
  it('isolamento: tenant B não vê nem consegue etiquetar conversa do tenant A', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });

    const result = await addLabel(TENANT_B, '595981111111', 'Interesada en pestañas');
    expect(result).toBeUndefined();

    const labelsA = await listLabels(TENANT_A, '595981111111');
    expect(labelsA).toEqual([]);
  });

  it('adicionar a mesma etiqueta com capitalização/acentuação diferente não duplica', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });

    await addLabel(TENANT_A, '595981111111', 'Interesada en pestañas');
    const labels = await addLabel(TENANT_A, '595981111111', 'interesada EN PESTAÑAS');

    expect(labels).toHaveLength(1);
    expect(labels).toEqual(['Interesada en pestañas']);
  });

  it('etiquetas diferentes se acumulam, na ordem em que foram adicionadas', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });

    await addLabel(TENANT_A, '595981111111', 'Interesada en pestañas');
    await addLabel(TENANT_A, '595981111111', 'Seña pendiente');

    const labels = await listLabels(TENANT_A, '595981111111');
    expect(labels).toEqual(['Interesada en pestañas', 'Seña pendiente']);
  });

  it('remove uma etiqueta pelo texto exato, mantendo as outras', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'Interesada en pestañas');
    await addLabel(TENANT_A, '595981111111', 'Seña pendiente');

    const labels = await removeLabel(TENANT_A, '595981111111', 'Interesada en pestañas');

    expect(labels).toEqual(['Seña pendiente']);
  });

  it('addLabel e removeLabel retornam undefined pra conversa inexistente', async () => {
    expect(await addLabel(TENANT_A, '000000000', 'Etiqueta')).toBeUndefined();
    expect(await removeLabel(TENANT_A, '000000000', 'Etiqueta')).toBeUndefined();
  });

  it('listAllTenantLabels devolve etiquetas distintas do tenant (deduplicadas), só de conversas próprias', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A1', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_A, '595982222222', 'Cliente A2', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_B, '595983333333', 'Cliente B', { type: 'text', text: 'oi', timestamp: '10:00' });

    await addLabel(TENANT_A, '595981111111', 'Interesada en pestañas');
    await addLabel(TENANT_A, '595982222222', 'interesada EN PESTAÑAS');
    await addLabel(TENANT_A, '595982222222', 'Seña pendiente');
    await addLabel(TENANT_B, '595983333333', 'Etiqueta do outro tenant');

    const labelsA = await listAllTenantLabels(TENANT_A);
    expect(labelsA.sort()).toEqual(['Interesada en pestañas', 'Seña pendiente'].sort());
  });
});
