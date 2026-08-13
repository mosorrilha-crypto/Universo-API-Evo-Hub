/**
 * markProcessedIfNew/unmarkProcessed (PR #202) dependem de uma violação de
 * chave única (Postgres error code 23505) no INSERT em
 * `processed_webhook_messages` pra detectar reentrega de webhook entre
 * instâncias — é literalmente o mecanismo que resolveu o bug real de
 * respostas duplicadas da IA (Set em memória por processo não pegava
 * reentrega caindo numa instância diferente do Render). `fakeSupabase.ts`
 * (usado no resto da suíte) não simula unicidade nenhuma no insert, então
 * nenhum teste existente exercita esse comportamento — sem isso, um futuro
 * `.insert()` trocado por `.upsert()` por engano quebraria a proteção
 * contra duplicata em silêncio, sem nenhum teste vermelho pra avisar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { markProcessedIfNew, unmarkProcessed } from '../idempotency';

/**
 * Fake dedicado (mesmo padrão de conversationStoreMessageInsertFailure.test.ts):
 * mantém um Set de message_id já "reivindicados" e simula a violação de
 * chave única (23505) que o Postgres real devolveria numa segunda tentativa
 * de INSERT com o mesmo message_id.
 */
function dbWithIdempotencyTable(opts?: { insertError?: { code?: string; message: string }; deleteError?: { message: string } }) {
  const base = createFakeSupabase();
  const claimed = new Set<string>();
  return {
    ...base,
    from(table: string) {
      if (table !== 'processed_webhook_messages') return base.from(table);
      return {
        insert: (payload: { message_id: string }) => ({
          then(resolve: (v: { data: any; error: any }) => any) {
            if (opts?.insertError) {
              return Promise.resolve(resolve({ data: null, error: opts.insertError }));
            }
            if (claimed.has(payload.message_id)) {
              return Promise.resolve(
                resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "processed_webhook_messages_pkey"' } })
              );
            }
            claimed.add(payload.message_id);
            return Promise.resolve(resolve({ data: [{ message_id: payload.message_id }], error: null }));
          },
        }),
        delete: () => ({
          eq: (column: string, value: any) => ({
            then(resolve: (v: { data: any; error: any }) => any) {
              if (opts?.deleteError) {
                return Promise.resolve(resolve({ data: null, error: opts.deleteError }));
              }
              if (column === 'message_id') claimed.delete(value);
              return Promise.resolve(resolve({ data: null, error: null }));
            },
          }),
        }),
      };
    },
    __claimed: claimed,
  } as any;
}

describe('markProcessedIfNew', () => {
  it('true na primeira vez que vê um message_id', async () => {
    initDb(dbWithIdempotencyTable());
    expect(await markProcessedIfNew('wamid.AAA')).toBe(true);
  });

  it('false numa reentrega do mesmo message_id (violação de chave única) — é o bug real que resolve', async () => {
    initDb(dbWithIdempotencyTable());
    expect(await markProcessedIfNew('wamid.BBB')).toBe(true);
    expect(await markProcessedIfNew('wamid.BBB')).toBe(false);
  });

  it('ids diferentes não interferem entre si', async () => {
    initDb(dbWithIdempotencyTable());
    expect(await markProcessedIfNew('wamid.CCC')).toBe(true);
    expect(await markProcessedIfNew('wamid.DDD')).toBe(true);
    expect(await markProcessedIfNew('wamid.CCC')).toBe(false);
  });

  it('em falha inesperada do Postgres (não 23505), processa mesmo assim em vez de arriscar perder a mensagem', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initDb(dbWithIdempotencyTable({ insertError: { message: 'connection timeout' } }));
    expect(await markProcessedIfNew('wamid.EEE')).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('unmarkProcessed', () => {
  it('desfaz a marcação — a mesma mensagem pode ser reivindicada de novo depois', async () => {
    const db = dbWithIdempotencyTable();
    initDb(db);
    expect(await markProcessedIfNew('wamid.FFF')).toBe(true);
    expect(await markProcessedIfNew('wamid.FFF')).toBe(false);

    await unmarkProcessed('wamid.FFF');

    expect(await markProcessedIfNew('wamid.FFF')).toBe(true);
  });

  it('em falha ao desmarcar, não lança — só avisa (não pode derrubar o webhook por causa disso)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initDb(dbWithIdempotencyTable({ deleteError: { message: 'connection timeout' } }));
    await expect(unmarkProcessed('wamid.GGG')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
