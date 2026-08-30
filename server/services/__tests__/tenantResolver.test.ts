/**
 * Regressão do PR #39: phone_number_id desconhecido nunca deve mais cair
 * silenciosamente no tenant legado (risco de vazamento cross-tenant — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 5).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { resolveTenantByPhoneNumberId, resolveTenantByEvolutionInstance, resolveCredentialsForConversation } from '../tenantResolver';
import { LEGACY_DEFAULT_TENANT_ID } from '../tenantContext';

const SHARED_PHONE_NUMBER_ID = 'shared-number-123';
const SHARED_EVOLUTION_INSTANCE = 'universo-shared';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_C = '33333333-3333-3333-3333-333333333333';
const TENANT_D = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  initDb(
    createFakeSupabase({
      tenant_meta_credentials: [
        { tenant_id: TENANT_B, phone_number_id: 'cadastrado-tenant-b', access_token: 'token-b' },
        { tenant_id: TENANT_D, phone_number_id: 'operacional-tenant-d', access_token: 'token-d' },
      ],
      tenant_evolution_credentials: [{ tenant_id: TENANT_C, instance_name: 'instancia-tenant-c', api_url: 'https://evo.example.com', api_key: 'key-c' }],
      broadcast_numbers: [{ tenant_id: TENANT_D, phone_number_id: 'disparo-tenant-d', access_token: 'token-disparo-d' }],
    })
  );
});

/**
 * TASK-0171 — sem isso, toda RESPOSTA de um contato de um disparo em massa
 * seria descartada silenciosamente (regra de "phone_number_id sem tenant
 * correspondente = mensagem jogada fora" já existente acima) — o bug mais
 * crítico que ficaria se o resolvedor não checasse também broadcast_numbers.
 */
describe('resolveTenantByPhoneNumberId — números de disparo em massa (broadcast_numbers)', () => {
  it('resolve pro tenant dono do número de disparo quando o phone_number_id bate com broadcast_numbers', async () => {
    const resolved = await resolveTenantByPhoneNumberId('disparo-tenant-d', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(TENANT_D);
    expect(resolved.metaAccessToken).toBe('token-disparo-d');
    expect(resolved.metaPhoneNumberId).toBe('disparo-tenant-d');
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('continua preferindo tenant_meta_credentials quando o número bate com o operacional, não com um de disparo', async () => {
    const resolved = await resolveTenantByPhoneNumberId('operacional-tenant-d', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(TENANT_D);
    expect(resolved.metaAccessToken).toBe('token-d');
  });
});

describe('resolveCredentialsForConversation', () => {
  it('conversa sem phone_number_id (legada) usa o número operacional do tenant', async () => {
    const resolved = await resolveCredentialsForConversation(TENANT_D, null, {}, {});
    expect(resolved.metaPhoneNumberId).toBe('operacional-tenant-d');
    expect(resolved.metaAccessToken).toBe('token-d');
  });

  it('conversa cujo phone_number_id é um número de disparo usa as credenciais desse número, não do operacional', async () => {
    const resolved = await resolveCredentialsForConversation(TENANT_D, 'disparo-tenant-d', {}, {});
    expect(resolved.metaPhoneNumberId).toBe('disparo-tenant-d');
    expect(resolved.metaAccessToken).toBe('token-disparo-d');
  });

  it('phone_number_id de conversa que não bate com nada conhecido cai no número operacional (nunca falha o envio)', async () => {
    const resolved = await resolveCredentialsForConversation(TENANT_D, 'numero-removido-que-nao-existe-mais', {}, {});
    expect(resolved.metaPhoneNumberId).toBe('operacional-tenant-d');
  });
});

describe('resolveTenantByPhoneNumberId', () => {
  it('resolve pro tenant cadastrado quando o phone_number_id bate', async () => {
    const resolved = await resolveTenantByPhoneNumberId('cadastrado-tenant-b', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(TENANT_B);
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('cai no tenant legado quando o número é exatamente o compartilhado configurado', async () => {
    const resolved = await resolveTenantByPhoneNumberId(SHARED_PHONE_NUMBER_ID, { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('cai no tenant legado quando não há phone_number_id no payload (provider sem essa metadata)', async () => {
    const resolved = await resolveTenantByPhoneNumberId(undefined, { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
  });

  it('NUNCA cai no tenant legado quando o número é desconhecido — retorna unknownChannel', async () => {
    const resolved = await resolveTenantByPhoneNumberId('numero-totalmente-desconhecido', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.unknownChannel).toBe(true);
    expect(resolved.tenantId).not.toBe(LEGACY_DEFAULT_TENANT_ID);
  });
});

/**
 * Epic 4.6 (Porta A — Evolution API, QR Code): mesma regra de segurança do
 * Bloco 2.B acima, agora resolvendo por instance_name em vez de
 * phone_number_id — instância desconhecida nunca cai silenciosamente no
 * tenant legado.
 */
describe('resolveTenantByEvolutionInstance', () => {
  it('resolve pro tenant cadastrado quando a instância bate, usando a api_key/api_url salvas', async () => {
    const resolved = await resolveTenantByEvolutionInstance('instancia-tenant-c', { evolutionInstanceName: SHARED_EVOLUTION_INSTANCE });
    expect(resolved.tenantId).toBe(TENANT_C);
    expect(resolved.provider).toBe('evolution');
    expect(resolved.evolutionApiUrl).toBe('https://evo.example.com');
    expect(resolved.evolutionApiKey).toBe('key-c');
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('cai no tenant legado quando a instância é exatamente a compartilhada configurada', async () => {
    const resolved = await resolveTenantByEvolutionInstance(SHARED_EVOLUTION_INSTANCE, { evolutionInstanceName: SHARED_EVOLUTION_INSTANCE, evolutionApiUrl: 'https://shared.example.com', evolutionApiKey: 'shared-key' });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
    expect(resolved.provider).toBe('evolution');
    expect(resolved.evolutionApiKey).toBe('shared-key');
  });

  it('cai no tenant legado quando não há instância no payload', async () => {
    const resolved = await resolveTenantByEvolutionInstance(undefined, { evolutionInstanceName: SHARED_EVOLUTION_INSTANCE });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
  });

  it('NUNCA cai no tenant legado quando a instância é desconhecida — retorna unknownChannel', async () => {
    const resolved = await resolveTenantByEvolutionInstance('instancia-totalmente-desconhecida', { evolutionInstanceName: SHARED_EVOLUTION_INSTANCE });
    expect(resolved.unknownChannel).toBe(true);
    expect(resolved.tenantId).not.toBe(LEGACY_DEFAULT_TENANT_ID);
  });
});
