/**
 * Etiquetas livres por conversa (addLabel/removeLabel/listLabels em
 * conversationLabelStore.ts). Segue o padrão de tenantIsolation.test.ts:
 * fake Supabase em memória via initDb(createFakeSupabase()).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage } from '../conversationStore';
import { addLabel, removeLabel, listLabels, listAllTenantLabels, listAllTenantLabelsWithUsage, renameLabelForTenant, deleteLabelForTenant } from '../conversationLabelStore';

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

  it('listAllTenantLabelsWithUsage conta quantas conversas usam cada etiqueta, ordenado do mais usado', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A1', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_A, '595982222222', 'Cliente A2', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'Turno confirmado');
    await addLabel(TENANT_A, '595982222222', 'Turno confirmado');
    await addLabel(TENANT_A, '595982222222', 'Seña pendiente');

    const withUsage = await listAllTenantLabelsWithUsage(TENANT_A);
    expect(withUsage).toEqual([
      { label: 'Turno confirmado', usageCount: 2 },
      { label: 'Seña pendiente', usageCount: 1 },
    ]);
  });

  it('renameLabelForTenant renomeia a etiqueta em todas as conversas do tenant de uma vez', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A1', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_A, '595982222222', 'Cliente A2', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'turno confirmado');
    await addLabel(TENANT_A, '595982222222', 'turno confirmado');

    const result = await renameLabelForTenant(TENANT_A, 'turno confirmado', 'Turno confirmado');
    expect(result.renamedCount).toBe(2);

    expect(await listLabels(TENANT_A, '595981111111')).toEqual(['Turno confirmado']);
    expect(await listLabels(TENANT_A, '595982222222')).toEqual(['Turno confirmado']);
  });

  it('renameLabelForTenant evita duplicar quando a conversa já tem a etiqueta nova', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A1', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'turno confirmado');
    await addLabel(TENANT_A, '595981111111', 'Turno confirmado extra');
    // Simula a conversa já tendo as duas variações por engano
    await addLabel(TENANT_A, '595981111111', 'Confirmado');

    const result = await renameLabelForTenant(TENANT_A, 'turno confirmado', 'Confirmado');
    expect(result.renamedCount).toBe(1);
    expect(await listLabels(TENANT_A, '595981111111')).toEqual(['Turno confirmado extra', 'Confirmado']);
  });

  it('renameLabelForTenant não vaza pro tenant errado', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_B, '595983333333', 'Cliente B', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'turno confirmado');
    await addLabel(TENANT_B, '595983333333', 'turno confirmado');

    await renameLabelForTenant(TENANT_A, 'turno confirmado', 'Turno confirmado');

    expect(await listLabels(TENANT_A, '595981111111')).toEqual(['Turno confirmado']);
    expect(await listLabels(TENANT_B, '595983333333')).toEqual(['turno confirmado']);
  });

  it('deleteLabelForTenant remove a etiqueta de todas as conversas do tenant', async () => {
    await recordIncomingMessage(TENANT_A, '595981111111', 'Cliente A1', { type: 'text', text: 'oi', timestamp: '10:00' });
    await recordIncomingMessage(TENANT_A, '595982222222', 'Cliente A2', { type: 'text', text: 'oi', timestamp: '10:00' });
    await addLabel(TENANT_A, '595981111111', 'Duda sobre dolor');
    await addLabel(TENANT_A, '595982222222', 'Duda sobre dolor');
    await addLabel(TENANT_A, '595982222222', 'Seña pendiente');

    const result = await deleteLabelForTenant(TENANT_A, 'Duda sobre dolor');
    expect(result.deletedCount).toBe(2);

    expect(await listLabels(TENANT_A, '595981111111')).toEqual([]);
    expect(await listLabels(TENANT_A, '595982222222')).toEqual(['Seña pendiente']);
  });
});
