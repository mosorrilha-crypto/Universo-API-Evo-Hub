/**
 * Assinaturas de Web Push do PWA do atendente (issue #159) — uma linha por
 * dispositivo/navegador, upsert por endpoint (reinstalar o PWA ou
 * reautorizar notificação gera o mesmo endpoint, nunca duplica linha).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  saveSubscription,
  removeSubscription,
  removeSubscriptionByEndpoint,
  listSubscriptionsForTenant,
} from '../pushSubscriptionStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const OPERATOR_A = 'op-a';

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('saveSubscription / listSubscriptionsForTenant', () => {
  it('grava uma assinatura nova e devolve ela na listagem do tenant', async () => {
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'), 'Mozilla/5.0');

    const subs = await listSubscriptionsForTenant(TENANT_A);
    expect(subs).toEqual([{ endpoint: 'https://push.example/a', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }]);
  });

  it('faz upsert por endpoint — reautorizar não duplica a linha', async () => {
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'));
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'));

    const subs = await listSubscriptionsForTenant(TENANT_A);
    expect(subs).toHaveLength(1);
  });

  it('isola assinaturas por tenant', async () => {
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'));
    await saveSubscription(TENANT_B, 'op-b', sub('https://push.example/b'));

    expect(await listSubscriptionsForTenant(TENANT_A)).toHaveLength(1);
    expect(await listSubscriptionsForTenant(TENANT_B)).toHaveLength(1);
  });
});

describe('removeSubscription / removeSubscriptionByEndpoint', () => {
  it('remove pelo tenant + endpoint', async () => {
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'));
    await removeSubscription(TENANT_A, 'https://push.example/a');

    expect(await listSubscriptionsForTenant(TENANT_A)).toHaveLength(0);
  });

  it('remove só pelo endpoint (usado quando o navegador confirma 404/410 — assinatura morta)', async () => {
    await saveSubscription(TENANT_A, OPERATOR_A, sub('https://push.example/a'));
    await removeSubscriptionByEndpoint('https://push.example/a');

    expect(await listSubscriptionsForTenant(TENANT_A)).toHaveLength(0);
  });
});
