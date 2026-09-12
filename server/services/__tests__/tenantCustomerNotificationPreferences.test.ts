/**
 * `customer_notification_preferences` (migration 0089) — preferências por
 * tenant pras 3 mensagens automáticas mandadas pro CLIENTE FINAL (lembrete
 * de agendamento, retomada de conversa parada, reengajamento automático do
 * funil), antes totalmente hardcoded pra todo tenant. Espelha
 * tenantAlertSettings.test.ts: leitura com defaults quando o tenant nunca
 * configurou nada (defaults reproduzem as constantes hardcoded de antes
 * desta tarefa); validação por campo/faixa; escrita faz merge POR GRUPO
 * (salvar um grupo nunca apaga customização já salva noutro).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  getTenantCustomerNotificationPreferences,
  setTenantCustomerNotificationPreferences,
  validateCustomerNotificationPreferences,
  DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES,
  funnelAutoFollowUpDelayMs,
} from '../tenantProfileStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Dr. Daniel Oliveira' }] }));
});

describe('getTenantCustomerNotificationPreferences', () => {
  it('tenant que nunca configurou nada: default reproduz exatamente o hardcoded de antes desta tarefa', async () => {
    const prefs = await getTenantCustomerNotificationPreferences(TENANT_A);
    expect(prefs).toEqual(DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES);
    expect(prefs.appointmentReminders.diaAnteriorMinLeadHours).toBe(72);
    expect(prefs.appointmentReminders.diaAnteriorEarliestTime).toBe('08:30');
    expect(prefs.appointmentReminders.mesmoDiaEarliestTime).toBe('07:30');
    expect(prefs.abandonedConversationReactivation.enabled).toBe(true);
    expect(prefs.funnelAutoFollowUp).toEqual({ enabled: true, delayHours: 2.5, businessHoursStart: 7, businessHoursEnd: 19 });
  });

  it('grupo salvo parcialmente: campos ausentes voltam com o default do grupo', async () => {
    await setTenantCustomerNotificationPreferences(TENANT_A, { funnelAutoFollowUp: { enabled: true, delayHours: 5, businessHoursStart: 7, businessHoursEnd: 19 } });
    const prefs = await getTenantCustomerNotificationPreferences(TENANT_A);
    expect(prefs.appointmentReminders).toEqual(DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders);
    expect(prefs.funnelAutoFollowUp.delayHours).toBe(5);
  });
});

describe('setTenantCustomerNotificationPreferences', () => {
  it('salvar um grupo não apaga customização já salva noutro (merge por grupo, não substituição do objeto inteiro)', async () => {
    await setTenantCustomerNotificationPreferences(TENANT_A, { abandonedConversationReactivation: { enabled: false } });
    await setTenantCustomerNotificationPreferences(TENANT_A, { funnelAutoFollowUp: { enabled: false, delayHours: 2.5, businessHoursStart: 7, businessHoursEnd: 19 } });

    const prefs = await getTenantCustomerNotificationPreferences(TENANT_A);
    expect(prefs.abandonedConversationReactivation.enabled).toBe(false);
    expect(prefs.funnelAutoFollowUp.enabled).toBe(false);
  });

  it('salvar appointmentReminders parcial preserva os campos não enviados do mesmo grupo', async () => {
    await setTenantCustomerNotificationPreferences(TENANT_A, { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, mesmoDiaEnabled: false } });
    await setTenantCustomerNotificationPreferences(TENANT_A, { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, mesmoDiaEnabled: false, diaAnteriorMinLeadHours: 48 } });

    const prefs = await getTenantCustomerNotificationPreferences(TENANT_A);
    expect(prefs.appointmentReminders.mesmoDiaEnabled).toBe(false);
    expect(prefs.appointmentReminders.diaAnteriorMinLeadHours).toBe(48);
  });
});

describe('validateCustomerNotificationPreferences', () => {
  it('aceita objeto parcial com um único grupo válido', () => {
    expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { enabled: false } })).toBe(true);
  });
  it('rejeita grupo desconhecido', () => {
    expect(validateCustomerNotificationPreferences({ grupoInventado: { enabled: true } })).toBe(false);
  });
  it('rejeita array/null no topo', () => {
    expect(validateCustomerNotificationPreferences([])).toBe(false);
    expect(validateCustomerNotificationPreferences(null)).toBe(false);
  });
  it('rejeita campo desconhecido dentro de um grupo válido', () => {
    expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { campoInventado: true } })).toBe(false);
  });

  describe('appointmentReminders', () => {
    it('rejeita diaAnteriorMinLeadHours fora da faixa (0-168)', () => {
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorMinLeadHours: -1 } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorMinLeadHours: 200 } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorMinLeadHours: 72 } })).toBe(true);
    });
    it('rejeita "HH:mm" mal formado', () => {
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorEarliestTime: '8:30' } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorEarliestTime: '25:00' } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ appointmentReminders: { diaAnteriorEarliestTime: '08:30' } })).toBe(true);
    });
  });

  describe('funnelAutoFollowUp', () => {
    it('rejeita delayHours fora da faixa (0.5-24)', () => {
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { delayHours: 0.1 } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { delayHours: 30 } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { delayHours: 2.5 } })).toBe(true);
    });
    it('rejeita businessHoursStart >= businessHoursEnd quando os dois vêm juntos', () => {
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { businessHoursStart: 19, businessHoursEnd: 7 } })).toBe(false);
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { businessHoursStart: 7, businessHoursEnd: 19 } })).toBe(true);
    });
    it('aceita businessHoursStart sozinho (sem o par, não dá pra comparar ainda)', () => {
      expect(validateCustomerNotificationPreferences({ funnelAutoFollowUp: { businessHoursStart: 7 } })).toBe(true);
    });
  });
});

describe('funnelAutoFollowUpDelayMs', () => {
  it('converte horas pra milissegundos', () => {
    expect(funnelAutoFollowUpDelayMs({ enabled: true, delayHours: 2.5, businessHoursStart: 7, businessHoursEnd: 19 })).toBe(2.5 * 60 * 60 * 1000);
  });
});
