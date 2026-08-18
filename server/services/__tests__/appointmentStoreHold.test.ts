/**
 * Issue #289 (18/08/2026) — criar_agendamento não cria mais o evento real no
 * Google Calendar direto, só uma reserva (payment_status='awaiting_payment',
 * sem eventId) até um operador aprovar o comprovante. Cobre as novas funções
 * de appointmentStore.ts que sustentam esse fluxo.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  createAppointmentHold,
  attachCalendarEventToHold,
  findOverlappingHold,
  getAppointmentForPhone,
  listTenantIdsWithExpiredHolds,
  listExpiredHolds,
} from '../appointmentStore';

const TENANT_A = 'tenant-a';
const PHONE_A = '595981111111';
const PHONE_B = '595982222222';

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('createAppointmentHold', () => {
  it('cria uma reserva sem eventId, com payment_status awaiting_payment', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    const appt = await getAppointmentForPhone(TENANT_A, PHONE_A);
    expect(appt).toMatchObject({ eventId: undefined, paymentStatus: 'awaiting_payment', heldUntil: '2026-08-15T12:00:00' });
  });

  it('sobrescreve um ciclo de pagamento resolvido de um agendamento anterior (mesmo telefone)', async () => {
    supabase.__tables.appointments = [
      { tenant_id: TENANT_A, phone: PHONE_A, event_id: 'evt-antigo', summary: 'Cejas', start_iso: '2020-01-01T09:00:00', end_iso: '2020-01-01T10:00:00', created_at: new Date().toISOString(), payment_status: 'confirmed' },
    ];
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    const appt = await getAppointmentForPhone(TENANT_A, PHONE_A);
    expect(appt).toMatchObject({ eventId: undefined, paymentStatus: 'awaiting_payment', summary: 'Microlips' });
  });
});

describe('attachCalendarEventToHold', () => {
  it('grava o eventId real e encerra a expiração (held_until null)', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    await attachCalendarEventToHold(TENANT_A, PHONE_A, 'evt-aprovado');
    const appt = await getAppointmentForPhone(TENANT_A, PHONE_A);
    expect(appt).toMatchObject({ eventId: 'evt-aprovado', heldUntil: undefined });
  });
});

describe('findOverlappingHold', () => {
  it('encontra uma reserva de OUTRO telefone que colide no intervalo', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    const overlap = await findOverlappingHold(TENANT_A, PHONE_B, '2026-08-15T11:00:00', '2026-08-15T12:30:00');
    expect(overlap?.summary).toBe('Microlips');
  });

  it('não conta a própria reserva do mesmo telefone', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    const overlap = await findOverlappingHold(TENANT_A, PHONE_A, '2026-08-15T10:00:00', '2026-08-15T11:30:00');
    expect(overlap).toBeUndefined();
  });

  it('não conta reservas que não colidem no horário', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2026-08-15T12:00:00',
    });
    const overlap = await findOverlappingHold(TENANT_A, PHONE_B, '2026-08-15T12:00:00', '2026-08-15T13:00:00');
    expect(overlap).toBeUndefined();
  });
});

describe('listTenantIdsWithExpiredHolds / listExpiredHolds', () => {
  it('só lista reservas awaiting_payment com held_until no passado', async () => {
    await createAppointmentHold(TENANT_A, PHONE_A, {
      summary: 'Vencida', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00', heldUntil: '2020-01-01T00:00:00.000Z',
    });
    await createAppointmentHold(TENANT_A, PHONE_B, {
      summary: 'Ainda válida', startIso: '2026-08-16T10:00:00', endIso: '2026-08-16T11:30:00', heldUntil: new Date(Date.now() + 3600_000).toISOString(),
    });

    const tenantIds = await listTenantIdsWithExpiredHolds();
    expect(tenantIds).toEqual([TENANT_A]);

    const expired = await listExpiredHolds(TENANT_A);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ phone: PHONE_A, summary: 'Vencida' });
  });
});
