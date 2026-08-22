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
  assignEscalation,
  deleteEscalation,
  getPendingOperatorGuidance,
  listEscalations,
  logEscalation,
  markOperatorGuidanceConsumed,
  resolveEscalation,
  submitOperatorReply,
} from '../escalationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('logEscalation — kind (verificação de pagamento unificada)', () => {
  it('default é "general" quando não informado', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu no meio da conversa');
    expect(esc.kind).toBe('general');
  });

  it('"payment_proof" quando informado explicitamente (webhooks.ts, comprovante de pagamento)', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Possível comprovante recebido', '[imagem]', 'payment_proof');
    expect(esc.kind).toBe('payment_proof');
  });
});

describe('governança do caso', () => {
  it('deduplica a mesma fonte e incrementa ocorrências sem criar outro card ativo', async () => {
    const first = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Falha de envio', 'Mensagem A', 'general', { sourceKey: 'message:wamid-1' });
    const second = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Falha de envio', 'Mensagem A', 'general', { sourceKey: 'message:wamid-1' });

    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
    expect((await listEscalations(TENANT_A)).filter((item) => item.sourceKey === 'message:wamid-1')).toHaveLength(1);
  });

  it('atribui, resolve com trilha de decisão e arquiva sem apagar a história', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Comprovante pendente', undefined, 'payment_proof');
    const assigned = await assignEscalation(TENANT_A, esc.id, 'operator-1', { id: 'operator-1', name: 'Monique' });
    expect(assigned?.status).toBe('assigned');
    expect(assigned?.assignedOperatorId).toBe('operator-1');

    const resolved = await resolveEscalation(TENANT_A, esc.id, {
      actor: { id: 'operator-1', name: 'Monique' },
      resolutionCode: 'payment_verified',
      resolutionNote: 'Comprovante conferido no banco.',
    });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolutionCode).toBe('payment_verified');
    expect(resolved?.resolvedAt).toBeTruthy();

    expect(await deleteEscalation(TENANT_A, esc.id, { id: 'operator-1' })).toBe(true);
    expect((await listEscalations(TENANT_A)).find((item) => item.id === esc.id)).toBeUndefined();
  });
});

describe('submitOperatorReply', () => {
  it('grava a orientação e o timestamp, undefined para escalonamento inexistente', async () => {
    const esc = await logEscalation(TENANT_A, PHONE, 'Cliente', 'Sumiu no meio da conversa');
    const updated = await submitOperatorReply(TENANT_A, esc.id, 'Diz que o horário de sábado ainda está livre.');
    expect(updated?.operatorReply).toBe('Diz que o horário de sábado ainda está livre.');
    expect(updated?.operatorReplyAt).toBeTruthy();
    expect(updated?.guidanceExpiresAt).toBeTruthy();
    expect(updated?.status).toBe('awaiting_customer');

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
