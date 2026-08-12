/**
 * Issue #97 — orientação do operador num escalonamento (submitOperatorReply)
 * e a fila de orientações ainda não usadas numa resposta real
 * (getPendingOperatorGuidance/markOperatorGuidanceConsumed), consumida por
 * webhooks.ts a cada nova mensagem do cliente pra decidir se retoma o
 * atendimento com base nela.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  logEscalation,
  submitOperatorReply,
  getPendingOperatorGuidance,
  markOperatorGuidanceConsumed,
} from '../escalationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('submitOperatorReply', () => {
  it('grava a orientação e o timestamp, undefined para escalonamento inexistente', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu no meio da conversa');
    const updated = await submitOperatorReply(TENANT_A, esc.id, 'Diz que o horário de sábado ainda está livre.');
    expect(updated?.operatorReply).toBe('Diz que o horário de sábado ainda está livre.');
    expect(updated?.operatorReplyAt).toBeTruthy();

    expect(await submitOperatorReply(TENANT_A, 'nao-existe', 'x')).toBeUndefined();
  });
});

describe('getPendingOperatorGuidance / markOperatorGuidanceConsumed', () => {
  it('sem nenhuma orientação ainda: não devolve nada', async () => {
    await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu');
    expect(await getPendingOperatorGuidance(TENANT_A, PHONE)).toBeUndefined();
  });

  it('orientação recém-submetida: fica pendente até ser consumida', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu');
    await submitOperatorReply(TENANT_A, esc.id, 'Orientação X');

    const pending = await getPendingOperatorGuidance(TENANT_A, PHONE);
    expect(pending?.id).toBe(esc.id);
    expect(pending?.operatorReply).toBe('Orientação X');

    await markOperatorGuidanceConsumed(TENANT_A, esc.id);
    expect(await getPendingOperatorGuidance(TENANT_A, PHONE)).toBeUndefined();
  });

  it('escalonamento já resolvido não conta como pendente mesmo com operator_reply preenchido', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu');
    await submitOperatorReply(TENANT_A, esc.id, 'Orientação X');
    await markOperatorGuidanceConsumed(TENANT_A, esc.id); // já marca resolved=true também

    expect(await getPendingOperatorGuidance(TENANT_A, PHONE)).toBeUndefined();
  });

  it('orientação de outro telefone não vaza pro telefone consultado', async () => {
    const esc = await logEscalation(TENANT_A, '595982222222', 'Outro Cliente', 'Sumiu');
    await submitOperatorReply(TENANT_A, esc.id, 'Orientação pro outro número');

    expect(await getPendingOperatorGuidance(TENANT_A, PHONE)).toBeUndefined();
  });
});
