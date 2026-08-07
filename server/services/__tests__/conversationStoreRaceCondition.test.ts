/**
 * Confirmado em produção via logs do Render (dois incidentes reais em
 * 2026-08-07, leads 595992961606 e 595983382913): getOrCreateConversationRow
 * fazia SELECT-depois-INSERT não atômico. Quando a 1ª mensagem de uma lead
 * nova chega com ctwa_clid (clique em anúncio), attachAdReferralIfMissing
 * (fire-and-forget) e recordIncomingMessage (awaited) chamam essa função ao
 * mesmo tempo pro mesmo tenant_id+phone — as duas confirmam que a conversa
 * "não existe" e tentam INSERT; uma vence, a outra recebia o erro real de
 * produção "duplicate key value violates unique constraint
 * \"conversations_tenant_id_phone_key\"\" sem tratamento, perdendo a
 * mensagem do lead. Este teste reproduz a race e comprova que agora as duas
 * chamadas concorrentes resolvem pra mesma conversa, sem lançar erro e sem
 * perder nenhuma mensagem.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage } from '../conversationStore';

/** Simula o erro real de unique_violation (Postgres code 23505) na 2ª inserção concorrente pro mesmo tenant_id+phone, igual ao que aconteceu em produção. */
function dbWithConversationInsertRace() {
  const base = createFakeSupabase();
  let conversationInsertCalls = 0;
  const db = {
    ...base,
    from(table: string) {
      const real = base.from(table);
      if (table !== 'conversations') return real;
      return {
        ...real,
        insert: (payload: Record<string, any>) => {
          conversationInsertCalls += 1;
          if (conversationInsertCalls === 1) return real.insert(payload);
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint "conversations_tenant_id_phone_key"' },
              }),
            }),
          };
        },
      };
    },
  } as any;
  return db;
}

describe('conversationStore — race condition na criação da conversa (getOrCreateConversationRow)', () => {
  let db: ReturnType<typeof dbWithConversationInsertRace>;

  beforeEach(() => {
    db = dbWithConversationInsertRace();
    initDb(db);
  });

  it('duas chamadas concorrentes pro mesmo tenant_id+phone novo resolvem pra mesma conversa, sem lançar erro e sem perder mensagem', async () => {
    await expect(
      Promise.all([
        recordIncomingMessage('tenant-1', '595992961606', undefined, { type: 'text', text: 'primeira mensagem', timestamp: '10:00' }),
        recordIncomingMessage('tenant-1', '595992961606', undefined, { type: 'text', text: 'segunda mensagem', timestamp: '10:00' }),
      ])
    ).resolves.toBeDefined();

    const conversations = db.__tables.conversations.filter((c: any) => c.tenant_id === 'tenant-1' && c.phone === '595992961606');
    expect(conversations).toHaveLength(1);

    const messages = db.__tables.messages.filter((m: any) => m.conversation_id === conversations[0].id);
    expect(messages.map((m: any) => m.text).sort()).toEqual(['primeira mensagem', 'segunda mensagem']);
  });
});
