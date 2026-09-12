/**
 * `admin_alert_phone` (número que recebe alertas operacionais reais via
 * WhatsApp) + preferência por tipo de alerta (migration 0087) — achado real
 * (12/09/2026): não existia nenhuma tela pra configurar isso, só SQL direto
 * no Supabase, e um tenant recebeu alertas configurados errado no número de
 * outro. Cobre: leitura com defaults quando o tenant nunca configurou nada;
 * validação de telefone/preferências; escrita faz merge (não apaga chaves
 * não enviadas) e usa getPlatformDb (mesmo motivo documentado em
 * setTenantBusinessHours — a tabela `tenants` não tem policy RLS de UPDATE
 * pro cliente tenant-scoped).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  getTenantAlertSettings,
  setTenantAlertSettings,
  validateAdminAlertPhone,
  validateAlertPreferences,
  DEFAULT_ALERT_PREFERENCES,
} from '../tenantProfileStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Dr. Daniel Oliveira' }] }));
});

describe('getTenantAlertSettings', () => {
  it('tenant que nunca configurou nada: telefone null, preferências default (tudo true)', async () => {
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.adminAlertPhone).toBeNull();
    expect(settings.preferences).toEqual(DEFAULT_ALERT_PREFERENCES);
  });

  it('preferências parciais salvas: chaves ausentes voltam com o default (true)', async () => {
    await setTenantAlertSettings(TENANT_A, { preferences: { evolution_disconnected: false } });
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.preferences).toEqual({ agent_paused: true, evolution_disconnected: false, system_error: true });
  });
});

describe('setTenantAlertSettings', () => {
  it('grava o telefone só com dígitos, mesmo mandado formatado', async () => {
    await setTenantAlertSettings(TENANT_A, { adminAlertPhone: '+595 (99) 000-0000' });
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.adminAlertPhone).toBe('595990000000');
  });

  it('adminAlertPhone: null remove o número configurado antes', async () => {
    await setTenantAlertSettings(TENANT_A, { adminAlertPhone: '595990000000' });
    await setTenantAlertSettings(TENANT_A, { adminAlertPhone: null });
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.adminAlertPhone).toBeNull();
  });

  it('atualizar só o telefone não mexe nas preferências já salvas', async () => {
    await setTenantAlertSettings(TENANT_A, { preferences: { system_error: false } });
    await setTenantAlertSettings(TENANT_A, { adminAlertPhone: '595990000000' });
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.preferences.system_error).toBe(false);
  });

  it('atualizar preferências faz merge, não substitui o objeto inteiro', async () => {
    await setTenantAlertSettings(TENANT_A, { preferences: { agent_paused: false } });
    await setTenantAlertSettings(TENANT_A, { preferences: { system_error: false } });
    const settings = await getTenantAlertSettings(TENANT_A);
    expect(settings.preferences).toEqual({ agent_paused: false, evolution_disconnected: true, system_error: false });
  });
});

describe('validateAdminAlertPhone', () => {
  it('aceita null (remove o número)', () => {
    expect(validateAdminAlertPhone(null)).toBe(true);
  });
  it('aceita número com 8 a 15 dígitos, ignorando formatação', () => {
    expect(validateAdminAlertPhone('+595 (99) 000-0000')).toBe(true);
  });
  it('rejeita string curta demais (menos de 8 dígitos)', () => {
    expect(validateAdminAlertPhone('12345')).toBe(false);
  });
  it('rejeita tipo errado (número em vez de string)', () => {
    expect(validateAdminAlertPhone(595990000000)).toBe(false);
  });
});

describe('validateAlertPreferences', () => {
  it('aceita objeto parcial com chaves conhecidas e valores booleanos', () => {
    expect(validateAlertPreferences({ agent_paused: false })).toBe(true);
  });
  it('rejeita chave desconhecida', () => {
    expect(validateAlertPreferences({ chave_inventada: true })).toBe(false);
  });
  it('rejeita valor não-booleano', () => {
    expect(validateAlertPreferences({ agent_paused: 'sim' })).toBe(false);
  });
  it('rejeita array/null', () => {
    expect(validateAlertPreferences([])).toBe(false);
    expect(validateAlertPreferences(null)).toBe(false);
  });
});
