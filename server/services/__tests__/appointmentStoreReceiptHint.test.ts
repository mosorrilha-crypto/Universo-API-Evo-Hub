/**
 * Resposta a uma pergunta real do dono do produto: o sistema não olhava o
 * conteúdo da imagem do comprovante, só o contexto. markPaymentPendingVerification
 * agora aceita a dica gerada pelo Gemini (paymentReceiptAnalysis.ts) e
 * persiste — e reseta a cada novo ciclo (reenvio depois de rejeição), mesma
 * cautela já aplicada a payment_pending_alerted_at (issue #98).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { setAppointmentForPhone, markPaymentPendingVerification, getAppointmentForPhone } from '../appointmentStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('markPaymentPendingVerification — dica do Gemini (payment_receipt_hint)', () => {
  it('persiste a dica quando fornecida', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    await markPaymentPendingVerification(TENANT_A, PHONE, 'wa-msg-1', 'Transferência de Gs 50.000, 12/08');

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentReceiptHint).toBe('Transferência de Gs 50.000, 12/08');
  });

  it('sem dica (análise indisponível), fica undefined — nunca quebra o fluxo', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    await markPaymentPendingVerification(TENANT_A, PHONE, 'wa-msg-1');

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentReceiptHint).toBeUndefined();
    expect(appt?.paymentStatus).toBe('pending_verification');
  });

  it('reenvio de comprovante (novo ciclo) reseta a dica antiga', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    await markPaymentPendingVerification(TENANT_A, PHONE, 'wa-msg-1', 'Dica do primeiro comprovante');
    await markPaymentPendingVerification(TENANT_A, PHONE, 'wa-msg-2'); // reenvio, sem dica nova (ex: análise falhou dessa vez)

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentReceiptHint).toBeUndefined();
  });
});
