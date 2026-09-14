/**
 * Modo "somente leads" (TASK-0411/TASK-0412, pedido real, 14/09/2026, ver
 * agentStatus.ts) — flag ortogonal ao status active/paused/restricted e a
 * ads_only, não um substituto de nenhum dos dois.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { isLeadsOnlyMode, setLeadsOnlyMode, isAdsOnlyMode, setAdsOnlyMode, getAgentStatus, setAgentStatus } from '../agentStatus';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('agentStatus — modo somente leads (leads_only)', () => {
  it('default é false quando nunca configurado', async () => {
    expect(await isLeadsOnlyMode(TENANT_A)).toBe(false);
  });

  it('ativa e persiste true', async () => {
    await setLeadsOnlyMode(TENANT_A, true);
    expect(await isLeadsOnlyMode(TENANT_A)).toBe(true);
  });

  it('desativa de novo', async () => {
    await setLeadsOnlyMode(TENANT_A, true);
    await setLeadsOnlyMode(TENANT_A, false);
    expect(await isLeadsOnlyMode(TENANT_A)).toBe(false);
  });

  it('isolado por tenant', async () => {
    await setLeadsOnlyMode(TENANT_A, true);
    expect(await isLeadsOnlyMode(TENANT_B)).toBe(false);
  });

  it('não é afetado por mudanças no status active/paused/restricted (flag ortogonal)', async () => {
    await setLeadsOnlyMode(TENANT_A, true);
    await setAgentStatus(TENANT_A, 'paused');
    expect(await isLeadsOnlyMode(TENANT_A)).toBe(true);
    expect(await getAgentStatus(TENANT_A)).toBe('paused');
  });

  it('convive com ads_only ativo ao mesmo tempo — os dois flags são independentes', async () => {
    await setAdsOnlyMode(TENANT_A, true);
    await setLeadsOnlyMode(TENANT_A, true);
    expect(await isAdsOnlyMode(TENANT_A)).toBe(true);
    expect(await isLeadsOnlyMode(TENANT_A)).toBe(true);
  });

  it('mudar leads_only não afeta ads_only nem o status já configurados', async () => {
    await setAgentStatus(TENANT_A, 'restricted');
    await setAdsOnlyMode(TENANT_A, true);
    await setLeadsOnlyMode(TENANT_A, true);
    expect(await getAgentStatus(TENANT_A)).toBe('restricted');
    expect(await isAdsOnlyMode(TENANT_A)).toBe(true);
  });
});
