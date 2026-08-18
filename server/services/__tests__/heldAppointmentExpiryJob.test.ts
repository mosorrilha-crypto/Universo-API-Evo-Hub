/**
 * Issue #289 (18/08/2026) — se o cliente nunca manda o comprovante, a
 * reserva feita por criar_agendamento (sem evento real ainda) precisa
 * liberar o horário sozinha depois do prazo, senão o telefone fica
 * bloqueado pra sempre e o horário nunca reaparece livre pra outro cliente.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createAppointmentHold, getAppointmentForPhone } from '../appointmentStore';
import { expireStaleHolds } from '../heldAppointmentExpiryJob';

const TENANT_A = 'tenant-a';
const PHONE_VENCIDA = '595981111111';
const PHONE_VALIDA = '595982222222';

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('expireStaleHolds', () => {
  it('libera (apaga) reservas vencidas, mas não mexe nas ainda válidas', async () => {
    await createAppointmentHold(TENANT_A, PHONE_VENCIDA, {
      summary: 'Vencida', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2020-01-01T00:00:00.000Z',
    });
    await createAppointmentHold(TENANT_A, PHONE_VALIDA, {
      summary: 'Ainda válida', startIso: '2026-08-16T10:00:00', endIso: '2026-08-16T11:30:00', heldUntil: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expireStaleHolds();

    expect(await getAppointmentForPhone(TENANT_A, PHONE_VENCIDA)).toBeUndefined();
    expect(await getAppointmentForPhone(TENANT_A, PHONE_VALIDA)).toMatchObject({ summary: 'Ainda válida' });
  });

  it('sem nenhuma reserva vencida, não faz nada', async () => {
    await createAppointmentHold(TENANT_A, PHONE_VALIDA, {
      summary: 'Ainda válida', startIso: '2026-08-16T10:00:00', endIso: '2026-08-16T11:30:00', heldUntil: new Date(Date.now() + 3600_000).toISOString(),
    });
    await expireStaleHolds();
    expect(await getAppointmentForPhone(TENANT_A, PHONE_VALIDA)).toMatchObject({ summary: 'Ainda válida' });
  });
});
