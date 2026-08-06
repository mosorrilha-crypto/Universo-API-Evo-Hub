/**
 * Testes de acesso cruzado entre tenants (Agente Vertical, Etapa 1 — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 7/8). Prova que tenant A nunca
 * lê, atualiza ou apaga dado de tenant B nos stores que exigem tenant_id —
 * é a "disciplina de código" citada na seção 5 do mapa como a barreira real
 * de isolamento hoje (a RLS existe mas não é avaliada, porque o backend usa
 * a service key do Supabase). Se um service um dia esquecer o filtro
 * tenant_id, esse teste é o que pega o erro.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createPreReservation, listPendingPreReservations, updatePreReservationStatus } from '../preReservationStore';
import { getAppointmentForPhone, setAppointmentForPhone, listAllAppointments, markPaymentPendingVerification } from '../appointmentStore';
import { logEscalation, listEscalations, resolveEscalation, deleteEscalation } from '../escalationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('isolamento entre tenants — pre_reservations', () => {
  it('tenant B não vê pré-reserva criada pelo tenant A', async () => {
    await createPreReservation(TENANT_A, {
      phone: '595981234567',
      serviceName: 'Microlips',
      committedDate: '2026-08-10T14:00:00Z',
      waMessageId: 'wamid.A1',
    });

    const aList = await listPendingPreReservations(TENANT_A);
    const bList = await listPendingPreReservations(TENANT_B);

    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(0);
  });

  it('tenant B não consegue atualizar status de pré-reserva do tenant A', async () => {
    const created = await createPreReservation(TENANT_A, {
      phone: '595981234567',
      serviceName: 'Microlips',
      committedDate: '2026-08-10T14:00:00Z',
      waMessageId: 'wamid.A2',
    });

    const result = await updatePreReservationStatus(TENANT_B, created.id, 'confirmed');
    expect(result).toBeUndefined();

    const stillPending = await listPendingPreReservations(TENANT_A);
    expect(stillPending[0].status).toBe('pending');
  });

  it('a mesma wa_message_id reentregue não duplica a pré-reserva (idempotência)', async () => {
    const input = {
      phone: '595981234567',
      serviceName: 'Microlips',
      committedDate: '2026-08-10T14:00:00Z',
      waMessageId: 'wamid.repetido',
    };
    const first = await createPreReservation(TENANT_A, input);
    const second = await createPreReservation(TENANT_A, input);

    expect(second.id).toBe(first.id);
    const list = await listPendingPreReservations(TENANT_A);
    expect(list).toHaveLength(1);
  });
});

describe('isolamento entre tenants — appointments / estado de pagamento', () => {
  it('tenant B não vê agendamento do tenant A pro mesmo telefone', async () => {
    await setAppointmentForPhone(TENANT_A, '595981234567', {
      eventId: 'evt-1',
      summary: 'Microlips',
      startIso: '2026-08-10T14:00:00-04:00',
      endIso: '2026-08-10T15:00:00-04:00',
    });

    const aAppt = await getAppointmentForPhone(TENANT_A, '595981234567');
    const bAppt = await getAppointmentForPhone(TENANT_B, '595981234567');

    expect(aAppt?.eventId).toBe('evt-1');
    expect(bAppt).toBeUndefined();
  });

  it('marcar comprovante pendente no tenant B não afeta o agendamento do tenant A', async () => {
    await setAppointmentForPhone(TENANT_A, '595981234567', {
      eventId: 'evt-2',
      summary: 'Microlips',
      startIso: '2026-08-10T14:00:00-04:00',
      endIso: '2026-08-10T15:00:00-04:00',
    });

    await markPaymentPendingVerification(TENANT_B, '595981234567', 'wamid.comprovante');

    const aAppt = await getAppointmentForPhone(TENANT_A, '595981234567');
    expect(aAppt?.paymentStatus).toBeUndefined();
  });

  it('listAllAppointments de um tenant nunca inclui linhas de outro', async () => {
    await setAppointmentForPhone(TENANT_A, '595981111111', { eventId: 'evt-a', summary: 'A', startIso: 's', endIso: 'e' });
    await setAppointmentForPhone(TENANT_B, '595982222222', { eventId: 'evt-b', summary: 'B', startIso: 's', endIso: 'e' });

    const aList = await listAllAppointments(TENANT_A);
    const bList = await listAllAppointments(TENANT_B);

    expect(aList.map((a) => a.eventId)).toEqual(['evt-a']);
    expect(bList.map((a) => a.eventId)).toEqual(['evt-b']);
  });
});

describe('isolamento entre tenants — escalations', () => {
  it('tenant B não vê escalonamento do tenant A', async () => {
    await logEscalation(TENANT_A, '595981234567', 'Cliente A', 'Mensagem sobre pagamento', 'oi');

    const aList = await listEscalations(TENANT_A);
    const bList = await listEscalations(TENANT_B);

    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(0);
  });

  it('tenant B não consegue resolver nem apagar escalonamento do tenant A', async () => {
    const created = await logEscalation(TENANT_A, '595981234567', 'Cliente A', 'Mensagem sobre pagamento', 'oi');

    const resolved = await resolveEscalation(TENANT_B, created.id);
    expect(resolved).toBeUndefined();

    const deleted = await deleteEscalation(TENANT_B, created.id);
    expect(deleted).toBe(false);

    const stillThere = await listEscalations(TENANT_A);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].resolved).toBe(false);
  });
});
