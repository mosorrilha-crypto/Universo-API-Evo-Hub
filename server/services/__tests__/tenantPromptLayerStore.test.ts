/**
 * Camada 1 por tenant (18/08/2026) — resolveEffectiveGlobalLayer é o que
 * autoReply.ts usa de verdade pra montar o prompt; getTenantPromptLayerRow
 * é o que a tela do painel usa pra mostrar/editar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeSupabase } from './fakeSupabase';
import { initDb } from '../db';
import { resolveEffectiveGlobalLayer, getTenantPromptLayerRow, setTenantPromptLayer, clearTenantPromptLayer } from '../tenantPromptLayerStore';
import { DEFAULT_GLOBAL_LAYER, setGlobalPromptLayer } from '../globalPromptStore';

const TENANT_A = 'tenant-a';
let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase({});
  initDb(supabase as any);
});

describe('resolveEffectiveGlobalLayer', () => {
  it('sem customização própria, usa a Camada 1 global (padrão hardcoded, sem override do saas_admin)', async () => {
    expect(await resolveEffectiveGlobalLayer(TENANT_A)).toBe(DEFAULT_GLOBAL_LAYER);
  });

  it('sem customização própria, mas COM override global do saas_admin, usa o override global', async () => {
    await setGlobalPromptLayer('Regra global customizada pelo saas_admin.', 'saas-admin-1');
    expect(await resolveEffectiveGlobalLayer(TENANT_A)).toBe('Regra global customizada pelo saas_admin.');
  });

  it('com customização própria do tenant, ignora a global (mesmo que a global tenha override do saas_admin)', async () => {
    await setGlobalPromptLayer('Regra global customizada pelo saas_admin.', 'saas-admin-1');
    await setTenantPromptLayer(TENANT_A, 'Regra só pra este tenant.', 'op-1');
    expect(await resolveEffectiveGlobalLayer(TENANT_A)).toBe('Regra só pra este tenant.');
  });

  it('depois de clearTenantPromptLayer, volta a herdar a global (inclusive uma mudança nova na global)', async () => {
    await setTenantPromptLayer(TENANT_A, 'Regra só pra este tenant.', 'op-1');
    await clearTenantPromptLayer(TENANT_A);
    await setGlobalPromptLayer('Global mudou depois do reset.', 'saas-admin-1');
    expect(await resolveEffectiveGlobalLayer(TENANT_A)).toBe('Global mudou depois do reset.');
  });
});

describe('getTenantPromptLayerRow', () => {
  it('isCustomized:false quando o tenant nunca editou', async () => {
    const row = await getTenantPromptLayerRow(TENANT_A);
    expect(row.isCustomized).toBe(false);
    expect(row.content).toBe(DEFAULT_GLOBAL_LAYER);
  });

  it('isCustomized:true depois de setTenantPromptLayer', async () => {
    await setTenantPromptLayer(TENANT_A, 'Minha regra.', 'op-1');
    const row = await getTenantPromptLayerRow(TENANT_A);
    expect(row.isCustomized).toBe(true);
    expect(row.content).toBe('Minha regra.');
    expect(row.updatedBy).toBe('op-1');
  });
});
