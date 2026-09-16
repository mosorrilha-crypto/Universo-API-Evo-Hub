/**
 * TASK-0423 — achado real (tenant Monique, conversa com Ruth Gonzalez,
 * 16/09/2026): um operador respondeu manualmente pelo painel a uma cliente
 * com uma pendência de reengajamento 'customer_reply' aberta, mas nada
 * cancelava essa pendência — o job automático (pendingFollowUpJob.ts) não
 * sabia que um humano já tinha reengajado, e mandou uma mensagem quase
 * idêntica ~7min depois. recordOutgoingMessage agora cancela a pendência
 * 'customer_reply' sempre que sentBy === 'operator' (nunca por 'ai' nem
 * 'campaign' — só um humano cuidando desta conversa específica conta).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordOutgoingMessage } from '../conversationStore';
import { markPendingFollowUp, listPendingFollowUps } from '../pendingFollowUpStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('recordOutgoingMessage — cancela pendência de reengajamento em resposta manual do operador', () => {
  it('sentBy=operator cancela uma pendência customer_reply aberta', async () => {
    await markPendingFollowUp(TENANT_A, PHONE, 'Ruth', 'customer_reply', 'ofereceu revisar horarios', '2026-09-16T22:00:00Z');
    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(1);

    await recordOutgoingMessage(TENANT_A, PHONE, { type: 'text', text: 'Hola Ruth, ¿cómo estás?', timestamp: '19:35' }, 'operator', undefined, undefined, undefined, 'Monique (Teste)');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(0);
  });

  it('sentBy=ai NÃO cancela a pendência (a resposta automática normal não conta como reengajamento manual)', async () => {
    await markPendingFollowUp(TENANT_A, PHONE, 'Ruth', 'customer_reply', 'ofereceu revisar horarios', '2026-09-16T22:00:00Z');

    await recordOutgoingMessage(TENANT_A, PHONE, { type: 'text', text: 'Resposta automática', timestamp: '19:35' }, 'ai');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(1);
  });

  it('sentBy=campaign NÃO cancela a pendência (disparo em massa não é alguém cuidando desta conversa)', async () => {
    await markPendingFollowUp(TENANT_A, PHONE, 'Ruth', 'customer_reply', 'ofereceu revisar horarios', '2026-09-16T22:00:00Z');

    await recordOutgoingMessage(TENANT_A, PHONE, { type: 'text', text: 'Promo do mês', timestamp: '19:35' }, 'campaign');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(1);
  });

  it('sentBy=operator não quebra quando não existe nenhuma pendência aberta', async () => {
    await expect(
      recordOutgoingMessage(TENANT_A, PHONE, { type: 'text', text: 'Hola!', timestamp: '19:35' }, 'operator')
    ).resolves.toBeDefined();
  });
});
