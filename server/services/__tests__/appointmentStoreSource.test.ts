/**
 * Issue #182 — `source` distingue agendamento criado pela IA ('ai', default)
 * de um cadastrado manualmente pelo operador ('manual'). Cobre o default
 * pra não quebrar os call sites existentes de autoReply.ts (criar_agendamento/
 * remarcar_agendamento), que nunca passam `source` explicitamente.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { setAppointmentForPhone, getAppointmentForPhone, clearAppointmentForPhone, setPaymentVerification } from '../appointmentStore';
import { listContactJourney } from '../contactJourneyStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('appointmentStore — source (issue #182)', () => {
  it('sem source explícito (call sites existentes da IA), assume "ai"', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.source).toBe('ai');
  });

  it('com source: "manual" explícito, persiste como manual', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-2', summary: 'Cejas', startIso: '2026-08-16T10:00:00', endIso: '2026-08-16T11:00:00', source: 'manual' });
    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.source).toBe('manual');
  });
});

describe('appointmentStore — jornada do contato (histórico de agendamentos)', () => {
  it('registra "created" no primeiro agendamento e "rescheduled" numa segunda chamada pro mesmo telefone', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Cílios', startIso: '2026-09-10T10:00:00', endIso: '2026-09-10T11:00:00' });
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Cílios', startIso: '2026-09-12T10:00:00', endIso: '2026-09-12T11:00:00' });

    const events = await listContactJourney(TENANT_A, PHONE);
    const appointmentEvents = events.filter((e) => e.kind === 'appointment').reverse();
    expect(appointmentEvents.map((e: any) => e.eventType)).toEqual(['created', 'rescheduled']);
  });

  it('registra "cancelled" ao limpar um agendamento existente', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-3', summary: 'Sobrancelhas', startIso: '2026-09-10T10:00:00', endIso: '2026-09-10T11:00:00' });
    await clearAppointmentForPhone(TENANT_A, PHONE);

    const events = await listContactJourney(TENANT_A, PHONE);
    expect((events[0] as any).eventType).toBe('cancelled');
  });

  it('não registra evento nenhum ao "cancelar" um telefone sem agendamento ativo', async () => {
    await clearAppointmentForPhone(TENANT_A, PHONE);
    const events = await listContactJourney(TENANT_A, PHONE);
    expect(events).toHaveLength(0);
  });

  it('registra "payment_verified" só quando o status vira "verified"', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-4', summary: 'Design', startIso: '2026-09-10T10:00:00', endIso: '2026-09-10T11:00:00' });
    await setPaymentVerification(TENANT_A, PHONE, 'rejected', 'operator-1');
    await setPaymentVerification(TENANT_A, PHONE, 'verified', 'operator-1');

    const events = await listContactJourney(TENANT_A, PHONE);
    const paymentEvents = events.filter((e: any) => e.eventType === 'payment_verified');
    expect(paymentEvents).toHaveLength(1);
  });
});
