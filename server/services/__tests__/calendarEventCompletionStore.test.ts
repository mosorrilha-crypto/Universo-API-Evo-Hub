import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { markEventCompleted, markEventNotCompleted, getCompletedEventIds } from '../calendarEventCompletionStore';
import { setAppointmentForPhone } from '../appointmentStore';
import { listContactJourney } from '../contactJourneyStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('calendarEventCompletionStore', () => {
  it('lista vazia quando nada foi marcado', async () => {
    expect(await getCompletedEventIds(TENANT_A, ['evt-1', 'evt-2'])).toEqual(new Set());
  });

  it('lista vazia sem query nenhuma quando eventIds vem vazio', async () => {
    expect(await getCompletedEventIds(TENANT_A, [])).toEqual(new Set());
  });

  it('marca um evento e ele aparece no resultado', async () => {
    await markEventCompleted(TENANT_A, 'evt-1');
    expect(await getCompletedEventIds(TENANT_A, ['evt-1', 'evt-2'])).toEqual(new Set(['evt-1']));
  });

  it('desmarca um evento já marcado', async () => {
    await markEventCompleted(TENANT_A, 'evt-1');
    await markEventNotCompleted(TENANT_A, 'evt-1');
    expect(await getCompletedEventIds(TENANT_A, ['evt-1'])).toEqual(new Set());
  });

  it('marcar de novo o mesmo evento não quebra (idempotente)', async () => {
    await markEventCompleted(TENANT_A, 'evt-1');
    await markEventCompleted(TENANT_A, 'evt-1');
    expect(await getCompletedEventIds(TENANT_A, ['evt-1'])).toEqual(new Set(['evt-1']));
  });

  it('isolado por tenant', async () => {
    await markEventCompleted(TENANT_A, 'evt-1');
    expect(await getCompletedEventIds(TENANT_B, ['evt-1'])).toEqual(new Set());
  });

  it('registra evento "completed" na jornada quando o evento está espelhado em appointments', async () => {
    await setAppointmentForPhone(TENANT_A, '595981111111', { eventId: 'evt-5', summary: 'Retoque', startIso: '2026-09-10T10:00:00', endIso: '2026-09-10T11:00:00' });
    await markEventCompleted(TENANT_A, 'evt-5');

    const events = await listContactJourney(TENANT_A, '595981111111');
    expect(events.some((e: any) => e.eventType === 'completed')).toBe(true);
  });

  it('não quebra ao marcar concluído um evento sem linha correspondente em appointments (criado direto no Google Calendar)', async () => {
    await expect(markEventCompleted(TENANT_A, 'evt-solto')).resolves.toBeUndefined();
  });
});
