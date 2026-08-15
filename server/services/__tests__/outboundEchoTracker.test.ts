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

  it('marca expirada (fora da janela de tolerância, 2min) não é consumida', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
      await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      vi.setSystemTime(new Date('2026-08-14T12:03:00Z')); // 3min depois, janela é 2min
      const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      expect(consumed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('achado real (15/08/2026): eco com latência de 90s (dentro da nova janela de 2min, fora da antiga de 30s) ainda é consumido', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
      await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      vi.setSystemTime(new Date('2026-08-14T12:01:30Z')); // 90s depois
      const consumed = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      expect(consumed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('limpa marcas nunca reclamadas há mais de 10min (envio que falhou/eco que nunca chegou), pra não colidir com mensagem futura de texto igual', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
      await registerPendingEcho(TENANT_A, '595981111111', 'text', 'Oi'); // nunca reclamada — simula envio que falhou

      vi.setSystemTime(new Date('2026-08-14T12:11:00Z')); // 11min depois, teto de limpeza é 10min
      // Consumir qualquer coisa (mesmo tenant) já dispara a limpeza best-effort.
      await consumePendingEcho(TENANT_A, '595981111119', 'text', 'outro texto qualquer');

      // Uma mensagem NOVA de texto igual, chegando bem depois, não deve mais achar a marca órfã.
      const consumedLater = await consumePendingEcho(TENANT_A, '595981111111', 'text', 'Oi');
      expect(consumedLater).toBe(false);
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
