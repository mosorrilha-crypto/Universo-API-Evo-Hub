/**
 * Achado real em produção (15/08/2026): o buffer de rajada vivia só em
 * memória — um restart de deploy no meio da janela de 6s de silêncio
 * perdia a mensagem inteira. Cobre aqui: agrupamento normal (comportamento
 * de sempre), isolamento por tenant (mesmo telefone falando com dois
 * tenants diferentes não deve colidir — bug latente corrigido junto),
 * persistência da marca e a recuperação via sweeper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { bufferIncomingText, startBufferRecoverySweeper } from '../messageBuffer';
import type { ResolvedTenant } from '../tenantResolver';

const TENANT_A: ResolvedTenant = { tenantId: 'tenant-a', provider: 'evolution', evolutionInstanceName: 'inst-a' };
const TENANT_B: ResolvedTenant = { tenantId: 'tenant-b', provider: 'evolution', evolutionInstanceName: 'inst-b' };

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('bufferIncomingText', () => {
  it('agrupa mensagens picotadas e dispara o callback uma vez só, depois do silêncio', async () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      bufferIncomingText('595981111111', 'Cliente', 'oi', 'msg-1', TENANT_A, onFlush);
      bufferIncomingText('595981111111', 'Cliente', 'tudo bem?', 'msg-2', TENANT_A, onFlush);
      await vi.advanceTimersByTimeAsync(6000);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('oi\ntudo bem?', 'Cliente', 'msg-2', 2, TENANT_A);
    } finally {
      vi.useRealTimers();
    }
  });

  it('achado real: o mesmo telefone falando com dois tenants diferentes não colide mais num buffer só', async () => {
    vi.useFakeTimers();
    try {
      const onFlushA = vi.fn();
      const onFlushB = vi.fn();
      bufferIncomingText('595981234567', 'Cliente', 'oi tenant A', 'msg-a', TENANT_A, onFlushA);
      bufferIncomingText('595981234567', 'Cliente', 'oi tenant B', 'msg-b', TENANT_B, onFlushB);
      await vi.advanceTimersByTimeAsync(6000);
      expect(onFlushA).toHaveBeenCalledWith('oi tenant A', 'Cliente', 'msg-a', 1, TENANT_A);
      expect(onFlushB).toHaveBeenCalledWith('oi tenant B', 'Cliente', 'msg-b', 1, TENANT_B);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persiste uma marca em pending_message_buffers ao bufferizar (melhor esforço, fire-and-forget)', async () => {
    bufferIncomingText('595982222222', 'Cliente', 'oi', 'msg-1', TENANT_A, vi.fn());
    await new Promise((r) => setTimeout(r, 10));
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595982222222');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: 'tenant-a', phone: '595982222222', texts: ['oi'], last_message_id: 'msg-1' });
  });

  it('remove a marca persistida depois de um flush normal (timer em memória, sem precisar do sweeper)', async () => {
    vi.useFakeTimers();
    try {
      bufferIncomingText('595983333333', 'Cliente', 'oi', 'msg-1', TENANT_A, vi.fn());
      await vi.advanceTimersByTimeAsync(6000);
    } finally {
      vi.useRealTimers();
    }
    await new Promise((r) => setTimeout(r, 10));
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595983333333');
    expect(rows).toHaveLength(0);
  });
});

describe('startBufferRecoverySweeper', () => {
  it('achado real: recupera uma marca presa de um restart anterior (flush_at já passou, nada em memória nesta instância)', async () => {
    supabase.__tables.pending_message_buffers = [
      {
        tenant_id: 'tenant-a',
        phone: '595984444444',
        texts: ['mensagem presa por um restart'],
        contact_name: 'Cliente Preso',
        last_message_id: 'msg-preso',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startBufferRecoverySweeper((phone) => (combinedText, contactName, lastMessageId, messageCount, resolvedTenant) => {
      recovered.push({ phone, combinedText, contactName, lastMessageId, messageCount, resolvedTenant });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      phone: '595984444444',
      combinedText: 'mensagem presa por um restart',
      contactName: 'Cliente Preso',
      lastMessageId: 'msg-preso',
      messageCount: 1,
    });
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595984444444');
    expect(rows).toHaveLength(0); // limpa depois de recuperar, não recupera de novo no próximo tick
  });

  it('ignora marca cujo flush_at ainda não chegou (não é recuperação, é um buffer normal em andamento)', async () => {
    supabase.__tables.pending_message_buffers = [
      {
        tenant_id: 'tenant-a',
        phone: '595985555555',
        texts: ['ainda dentro da janela'],
        contact_name: null,
        last_message_id: 'msg-futuro',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startBufferRecoverySweeper((phone) => (combinedText) => {
      recovered.push({ phone, combinedText });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toHaveLength(0);
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595985555555');
    expect(rows).toHaveLength(1); // continua lá, ninguém mexeu
  });
});
