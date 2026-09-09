/**
 * Jornada do paciente/cliente: log append-only mesclando agendamentos +
 * mudanças de estágio do CRM por contato. Ver
 * supabase/migrations/0080_contact_journey_history.sql. Cobre gravação
 * best-effort (nunca lança) e a mescla/ordenação de leitura.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordAppointmentJourneyEvent, recordCrmStageChange, listContactJourney } from '../contactJourneyStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('contactJourneyStore', () => {
  it('registra e lista um evento de agendamento', async () => {
    await recordAppointmentJourneyEvent(TENANT_A, PHONE, {
      eventType: 'created',
      serviceSummary: 'Cílios volume russo',
      scheduledStart: '2026-09-10T10:00:00',
      scheduledEnd: '2026-09-10T11:00:00',
      actor: 'ai',
    });

    const events = await listContactJourney(TENANT_A, PHONE);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'appointment', eventType: 'created', serviceSummary: 'Cílios volume russo', actor: 'ai' });
  });

  it('registra e lista uma mudança de estágio do CRM', async () => {
    await recordCrmStageChange(TENANT_A, PHONE, 'novo', 'contato', 'operator-1');

    const events = await listContactJourney(TENANT_A, PHONE);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'stage_change', fromStage: 'novo', toStage: 'contato', changedBy: 'operator-1' });
  });

  it('mescla agendamentos e mudanças de estágio, mais recente primeiro', async () => {
    await recordCrmStageChange(TENANT_A, PHONE, undefined, 'novo');
    await new Promise((resolve) => setTimeout(resolve, 2));
    await recordAppointmentJourneyEvent(TENANT_A, PHONE, { eventType: 'created', actor: 'ai' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await recordCrmStageChange(TENANT_A, PHONE, 'novo', 'contato');

    const events = await listContactJourney(TENANT_A, PHONE);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['stage_change', 'appointment', 'stage_change']);
    expect((events[0] as any).toStage).toBe('contato');
  });

  it('isolamento: tenant B nunca vê a jornada do tenant A', async () => {
    await recordAppointmentJourneyEvent(TENANT_A, PHONE, { eventType: 'created' });
    const eventsB = await listContactJourney(TENANT_B, PHONE);
    expect(eventsB).toHaveLength(0);
  });

  it('nunca lança quando a gravação falha (best-effort)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initDb(null); // getDb() vai lançar "banco não configurado"
    await expect(recordAppointmentJourneyEvent(TENANT_A, PHONE, { eventType: 'created' })).resolves.toBeUndefined();
    await expect(recordCrmStageChange(TENANT_A, PHONE, 'novo', 'contato')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
