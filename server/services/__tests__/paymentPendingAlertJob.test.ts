/**
 * Issue #98 — job de alerta de pagamento pendente de verificação há mais de
 * 2h. Cobre: pagamento pending_verification há mais de 2h gera 1
 * escalonamento; rodar o job duas vezes seguidas não duplica (idempotência
 * via payment_pending_alerted_at); pendente há menos de 2h ainda não gera
 * nada; pagamento já verificado/confirmado não gera nada; reenvio de
 * comprovante depois de rejeição reabre um novo ciclo de alerta.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { setAppointmentForPhone, markPaymentPendingVerification, setPaymentVerification } from '../appointmentStore';
import { listEscalations } from '../escalationStore';
import { checkPaymentPendingAndAlert } from '../paymentPendingAlertJob';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

async function seedAppointment(phone: string) {
  await setAppointmentForPhone(TENANT_A, phone, {
    eventId: `evt-${phone}`,
    summary: 'Corte + Escova',
    startIso: '2026-08-12T15:00:00Z',
    endIso: '2026-08-12T16:00:00Z',
  });
}

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-12T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('paymentPendingAlertJob', () => {
  it('pagamento pending_verification há mais de 2h gera 1 escalonamento pro operador', async () => {
    await seedAppointment('595981111111');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-1');
    vi.setSystemTime(new Date('2026-08-12T14:30:00Z')); // 2h30 depois

    await checkPaymentPendingAndAlert();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].phone).toBe('595981111111');
    expect(escalations[0].reason).toContain('pendente de verificação');
  });

  it('pagamento pending_verification há MENOS de 2h ainda não gera nada', async () => {
    await seedAppointment('595981111111');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-1');
    vi.setSystemTime(new Date('2026-08-12T13:00:00Z')); // só 1h depois

    await checkPaymentPendingAndAlert();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('rodar o job duas vezes seguidas NÃO duplica o escalonamento (idempotência)', async () => {
    await seedAppointment('595981111111');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-1');
    vi.setSystemTime(new Date('2026-08-12T14:30:00Z'));

    await checkPaymentPendingAndAlert();
    await checkPaymentPendingAndAlert();

    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('pagamento já verificado não gera nenhum escalonamento', async () => {
    await seedAppointment('595981111111');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-1');
    await setPaymentVerification(TENANT_A, '595981111111', 'verified', 'op-1');
    vi.setSystemTime(new Date('2026-08-12T14:30:00Z'));

    await checkPaymentPendingAndAlert();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('reenvio de comprovante após rejeição reabre um novo ciclo de alerta', async () => {
    await seedAppointment('595981111111');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-1');
    vi.setSystemTime(new Date('2026-08-12T14:30:00Z'));
    await checkPaymentPendingAndAlert();
    expect(await listEscalations(TENANT_A)).toHaveLength(1);

    await setPaymentVerification(TENANT_A, '595981111111', 'rejected', 'op-1');
    await markPaymentPendingVerification(TENANT_A, '595981111111', 'wa-msg-2'); // cliente reenviou
    vi.setSystemTime(new Date('2026-08-12T17:00:00Z')); // +2h30 do novo envio

    await checkPaymentPendingAndAlert();

    expect(await listEscalations(TENANT_A)).toHaveLength(2);
  });

  it('agendamento sem pagamento pendente (payment_status null) não gera nada', async () => {
    await seedAppointment('595981111111');
    vi.setSystemTime(new Date('2026-08-12T20:00:00Z'));

    await checkPaymentPendingAndAlert();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });
});
