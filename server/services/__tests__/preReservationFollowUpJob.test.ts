/**
 * Etapa 7 — job de follow-up de pré-reserva vencida. Cobre: pré-reserva
 * pending com data de hoje/passado gera 1 escalonamento pro operador; rodar
 * o job duas vezes seguidas não duplica (idempotência via
 * followup_alerted_at); pré-reserva não-pending não gera nada; data no
 * futuro não gera nada ainda.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createPreReservation, updatePreReservationStatus } from '../preReservationStore';
import { listEscalations } from '../escalationStore';
import { checkPreReservationFollowUps } from '../preReservationFollowUpJob';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // "hoje" fixo pros testes, ao meio-dia UTC
});

afterEach(() => {
  vi.useRealTimers();
});

describe('preReservationFollowUpJob', () => {
  it('pré-reserva pending com data combinada de hoje gera 1 escalonamento pro operador', async () => {
    await createPreReservation(TENANT_A, {
      phone: '595981111111',
      contactName: 'Cliente A',
      serviceName: 'Lifting de Pestañas',
      committedDate: '2026-08-10',
      waMessageId: 'wa-1',
    });

    await checkPreReservationFollowUps();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].phone).toBe('595981111111');
    expect(escalations[0].reason).toContain('Lifting de Pestañas');
    expect(escalations[0].reason).toContain('2026-08-10');
  });

  it('pré-reserva com data combinada PASSADA (ainda pending) também gera escalonamento', async () => {
    await createPreReservation(TENANT_A, {
      phone: '595981111111',
      serviceName: 'Cejas',
      committedDate: '2026-08-05', // antes de "hoje" (10/08)
      waMessageId: 'wa-2',
    });

    await checkPreReservationFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('pré-reserva com data combinada no FUTURO não gera nada ainda', async () => {
    await createPreReservation(TENANT_A, {
      phone: '595981111111',
      serviceName: 'Labios',
      committedDate: '2026-08-15', // depois de "hoje" (10/08)
      waMessageId: 'wa-3',
    });

    await checkPreReservationFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('rodar o job duas vezes seguidas NÃO duplica o escalonamento (idempotência)', async () => {
    await createPreReservation(TENANT_A, {
      phone: '595981111111',
      serviceName: 'Lifting de Pestañas',
      committedDate: '2026-08-10',
      waMessageId: 'wa-4',
    });

    await checkPreReservationFollowUps();
    await checkPreReservationFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('pré-reserva já confirmed não gera nenhum escalonamento', async () => {
    const pr = await createPreReservation(TENANT_A, {
      phone: '595981111111',
      serviceName: 'Cejas',
      committedDate: '2026-08-10',
      waMessageId: 'wa-5',
    });
    await updatePreReservationStatus(TENANT_A, pr.id, 'confirmed');

    await checkPreReservationFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('pré-reserva já cancelled/expired não gera nenhum escalonamento', async () => {
    const cancelled = await createPreReservation(TENANT_A, {
      phone: '595981111111',
      serviceName: 'Cejas',
      committedDate: '2026-08-10',
      waMessageId: 'wa-6',
    });
    await updatePreReservationStatus(TENANT_A, cancelled.id, 'cancelled');

    const expired = await createPreReservation(TENANT_A, {
      phone: '595982222222',
      serviceName: 'Labios',
      committedDate: '2026-08-10',
      waMessageId: 'wa-7',
    });
    await updatePreReservationStatus(TENANT_A, expired.id, 'expired');

    await checkPreReservationFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });
});
