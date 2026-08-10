/**
 * Achado consultando uma lead real de produção: conversa com ctwa_clid
 * gravado (veio de clique em anúncio) mas 0 mensagens salvas. Rastreado até
 * recordIncomingMessage/recordOutgoingMessage engolindo o erro do insert em
 * `messages` (só console.error, nunca relançava) — o try/catch em
 * webhooks.ts que desmarca a mensagem em idempotency.ts (pra permitir
 * reentrega da Meta) nunca via a falha, então a mensagem ficava marcada como
 * "processada" pra sempre sem nunca ter sido persistida. Estes testes
 * comprovam que a falha agora escapa da função.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordIncomingMessage, recordOutgoingMessage } from '../conversationStore';

function dbWithMessagesInsertFailure() {
  const base = createFakeSupabase();
  return {
    ...base,
    from(table: string) {
      const real = base.from(table);
      if (table !== 'messages') return real;
      return {
        ...real,
        insert: () => ({
          then(resolve: (v: { data: null; error: { message: string } }) => any) {
            return Promise.resolve(resolve({ data: null, error: { message: 'insert falhou (simulado)' } }));
          },
        }),
      };
    },
  } as any;
}

describe('conversationStore — falha ao gravar mensagem', () => {
  beforeEach(() => {
    initDb(dbWithMessagesInsertFailure());
  });

  it('recordIncomingMessage relança o erro em vez de engolir', async () => {
    await expect(
      recordIncomingMessage('tenant-1', '595981828280', undefined, { type: 'text', text: 'oi', timestamp: '10:00' })
    ).rejects.toThrow('Falha ao gravar mensagem recebida');
  });

  it('recordOutgoingMessage relança o erro em vez de engolir', async () => {
    await expect(
      recordOutgoingMessage('tenant-1', '595981828280', { type: 'text', text: 'oi, tudo bem?', timestamp: '10:00' }, 'ai')
    ).rejects.toThrow('Falha ao gravar mensagem enviada');
  });
});
