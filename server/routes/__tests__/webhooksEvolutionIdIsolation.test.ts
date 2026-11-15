import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

vi.mock('../../services/tenantResolver', () => ({
  resolveTenantByEvolutionInstance: vi.fn(async (instance: string) => ({
    tenantId: instance === 'lucas' ? 'tenant-lucas' : 'tenant-monique',
    provider: 'evolution', evolutionInstanceName: instance,
  })),
}));
vi.mock('../../services/tenantDbContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/tenantDbContext')>(),
  runWithTenantDbContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

let db: ReturnType<typeof createFakeSupabase>;
beforeEach(() => {
  db = createFakeSupabase();
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table !== 'messages' && table !== 'processed_webhook_messages') return query;
    return { ...query, insert: (row: any) => {
      const key = table === 'messages' ? 'id' : 'message_id';
      if ((db.__tables[table] || []).some((existing: any) => existing[key] === row[key])) {
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
      }
      return query.insert(row);
    } };
  };
  initDb(db);
});

async function deliver(instance: string, id = 'same-id') {
  const router = createWebhooksRouter({ metaWebhookVerifyToken: 'test' });
  const route = router.stack.find((layer: any) => layer.route?.path === '/api/webhooks/evolution' && layer.route.methods.post);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await route!.route.stack[0].handle({ headers: {}, body: {
    event: 'messages.upsert', instance,
    data: { key: { id, remoteJid: '595981234567@s.whatsapp.net', fromMe: true }, message: { conversation: 'Teste' } },
  } } as any, res as any, vi.fn());
  expect(res.status).toHaveBeenCalledWith(200);
}

describe('IDs Evolution entre empresas', () => {
  it('preserva PK global e duas cópias da mesma mensagem sem duplicar reentrega', async () => {
    await deliver('lucas');
    await deliver('monique');
    await deliver('lucas');
    expect(db.__tables.messages.map((row: any) => [row.tenant_id, row.id])).toEqual([
      ['tenant-lucas', 'evo:lucas:same-id'], ['tenant-monique', 'evo:monique:same-id'],
    ]);
    expect(new Set(db.__tables.messages.map((row: any) => row.id)).size).toBe(2);
    expect(db.__tables.processed_webhook_messages.map((row: any) => row.message_id)).toEqual([
      'evolution:lucas:same-id', 'evolution:monique:same-id',
    ]);
    expect(db.__tables.escalations || []).toHaveLength(0);
  });

  it('uma mensagem legada de outra empresa não bloqueia Lucas', async () => {
    await db.from('messages').insert({ id: 'same-id', tenant_id: 'tenant-monique', sender: 'lead', type: 'text' });
    await deliver('lucas');
    expect(db.__tables.messages).toHaveLength(2);
    expect(db.__tables.messages[1].id).toBe('evo:lucas:same-id');
  });

  it('reentrega legada do próprio tenant preserva o histórico', async () => {
    await db.from('messages').insert({ id: 'same-id', tenant_id: 'tenant-lucas', sender: 'agent', type: 'text', text: 'Original' });
    await deliver('lucas');
    expect(db.__tables.messages).toHaveLength(1);
    expect(db.__tables.messages[0].text).toBe('Original');
  });
});
