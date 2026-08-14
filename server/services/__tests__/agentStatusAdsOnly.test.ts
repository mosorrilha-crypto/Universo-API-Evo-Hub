/**
 * Modo "somente anúncios" (pedido real, 14/08/2026, ver agentStatus.ts) —
 * flag ortogonal ao status active/paused/restricted, não um 4º valor dele.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { isAdsOnlyMode, setAdsOnlyMode, getAgentStatus, setAgentStatus } from '../agentStatus';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('agentStatus — modo somente anúncios (ads_only)', () => {
  it('default é false quando nunca configurado', async () => {
    expect(await isAdsOnlyMode(TENANT_A)).toBe(false);
  });

  it('ativa e persiste true', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    expect(await isAdsOnlyMode(TENANT_A)).toBe(true);
  });

  it('desativa de novo', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await setAdsOnlyMode(TENANT_A, false);
    expect(await isAdsOnlyMode(TENANT_A)).toBe(false);
  });

  it('isolado por tenant', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    expect(await isAdsOnlyMode(TENANT_B)).toBe(false);
  });

  it('não é afetado por mudanças no status active/paused/restricted (flag ortogonal)', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await setAgentStatus(TENANT_A, 'paused');
    expect(await isAdsOnlyMode(TENANT_A)).toBe(true);
    expect(await getAgentStatus(TENANT_A)).toBe('paused');
  });

  it('mudar ads_only não afeta o status active/paused/restricted já configurado', async () => {
    await setAgentStatus(TENANT_A, 'restricted');
    await setAdsOnlyMode(TENANT_A, true);
    expect(await getAgentStatus(TENANT_A)).toBe('restricted');
  });
});
