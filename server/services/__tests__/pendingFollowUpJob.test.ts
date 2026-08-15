/**
 * Acompanhamento de funil (pedido real, 15/08/2026 — auditoria de conversas
 * reais mostrou ZERO agendamentos fechados no dia apesar de dezenas de
 * conversas ativas). Cobre: pendência vencida gera 1 escalonamento; rodar o
 * job duas vezes não duplica; pendência ainda não vencida não gera nada;
 * cancelar (clearPendingFollowUp) remove antes do job rodar.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { markPendingFollowUp, clearPendingFollowUp, listPendingFollowUps } from '../pendingFollowUpStore';
import { listEscalations } from '../escalationStore';
import { checkPendingFollowUps } from '../pendingFollowUpJob';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-15T18:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pendingFollowUpStore', () => {
  it('markPendingFollowUp não duplica quando já existe uma pendência aberta do mesmo (tenant, phone, kind)', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T20:30:00Z');
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu outro horário', '2026-08-15T21:00:00Z');

    const pending = await listPendingFollowUps(TENANT_A);
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe('ofereceu outro horário');
  });

  it('clearPendingFollowUp remove a pendência ainda não alertada', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado', '2026-08-15T20:30:00Z');
    await clearPendingFollowUp(TENANT_A, '595981111111', 'customer_reply');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(0);
  });

  it('kinds diferentes pro mesmo telefone não colidem', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'esperando escolha', '2026-08-15T20:30:00Z');
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'foto de trabalho anterior', '2026-08-15T20:00:00Z');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(2);
  });
});

describe('pendingFollowUpJob', () => {
  it('pendência vencida (due_at no passado) gera 1 escalonamento pro operador', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].phone).toBe('595981111111');
    expect(escalations[0].kind).toBe('customer_reply');
    expect(escalations[0].reason).toContain('ofereceu sábado ou segunda');
  });

  it('pendência ainda não vencida (due_at no futuro) não gera nada ainda', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'foto de trabalho anterior', '2026-08-15T23:00:00Z');

    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('rodar o job duas vezes seguidas NÃO duplica o escalonamento (idempotência)', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu horário', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();
    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('pendência cancelada antes do job rodar não gera nenhum escalonamento', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu horário', '2026-08-15T17:00:00Z');
    await clearPendingFollowUp(TENANT_A, '595981111111', 'customer_reply');

    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('reason do escalonamento distingue owner_review de customer_reply', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'trabalho anterior de cejas', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations[0].reason).toContain('avaliação');
    expect(escalations[0].reason).toContain('trabalho anterior de cejas');
  });
});
