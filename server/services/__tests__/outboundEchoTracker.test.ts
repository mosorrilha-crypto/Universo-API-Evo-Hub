/**
 * Distingue eco fromMe:true (Evolution API) de mensagem que já mandamos vs
 * mandada direto do celular conectado — ver server/routes/webhooks.ts pra
 * como isso é usado no fluxo real. Cobre aqui só a lógica de registro/
 * consumo em si, isolada da rota HTTP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { registerPendingEcho, consumePendingEcho } from '../outboundEchoTracker';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('outboundEchoTracker', () => {
  it('consome uma marca pendente de texto que bate exatamente', async () => {
    await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi, tudo bem?');
    const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi, tudo bem?');
    expect(consumed).toBe(true);
  });

  it('não consome se o texto for diferente (mesmo telefone/tipo)', async () => {
    await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi, tudo bem?');
    const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Outra coisa');
    expect(consumed).toBe(false);
  });

  it('não consome sem nenhuma marca registrada', async () => {
    const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi, tudo bem?');
    expect(consumed).toBe(false);
  });

  it('mídia (áudio/imagem) casa só por telefone+tipo, sem precisar de texto', async () => {
    await registerPendingEcho(TENANT_A, '595981111111', 'audio');
    const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'audio');
    expect(consumed).toBe(true);
  });

  it('consumir remove a marca — uma segunda tentativa igual não acha mais nada', async () => {
    await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
    expect(await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi')).toBe(true);
    expect(await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi')).toBe(false);
  });

  it('marca expirada (fora da janela de tolerância) não é consumida', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
      await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      vi.setSystemTime(new Date('2026-08-14T12:01:00Z')); // 60s depois, janela é 30s
      const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      expect(consumed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('não vaza entre tenants diferentes', async () => {
    await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
    const consumed = await consumePendingEcho('22222222-2222-2222-2222-222222222222', '595981111111', 'text', 'Oi');
    expect(consumed).toBe(false);
  });
});
