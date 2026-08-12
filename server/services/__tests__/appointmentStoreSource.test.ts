/**
 * Issue #182 — `source` distingue agendamento criado pela IA ('ai', default)
 * de um cadastrado manualmente pelo operador ('manual'). Cobre o default
 * pra não quebrar os call sites existentes de autoReply.ts (criar_agendamento/
 * remarcar_agendamento), que nunca passam `source` explicitamente.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { setAppointmentForPhone, getAppointmentForPhone } from '../appointmentStore';

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
