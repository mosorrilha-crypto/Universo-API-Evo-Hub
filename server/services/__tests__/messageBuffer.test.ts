/**
 * Achado real em produção (15/08/2026): o buffer de rajada vivia só em
 * memória — um restart de deploy no meio da janela de 10s de silêncio
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
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('oi\ntudo bem?', 'Cliente', 'msg-2', 2, TENANT_A, 'msg-1');
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
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFlushA).toHaveBeenCalledWith('oi tenant A', 'Cliente', 'msg-a', 1, TENANT_A, 'msg-a');
      expect(onFlushB).toHaveBeenCalledWith('oi tenant B', 'Cliente', 'msg-b', 1, TENANT_B, 'msg-b');
    } finally {
      vi.useRealTimers();
    }
  });

  it('persiste uma marca em pending_message_buffers ao bufferizar (melhor esforço, fire-and-forget)', async () => {
    bufferIncomingText('595982222222', 'Cliente', 'oi', 'msg-1', TENANT_A, vi.fn());
    await new Promise((r) => setTimeout(r, 10));
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595982222222');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: 'tenant-a', phone: '595982222222', texts: ['oi'], last_message_id: 'msg-1', first_message_id: 'msg-1' });
  });

  it('remove a marca persistida depois de um flush normal (timer em memória, sem precisar do sweeper)', async () => {
    vi.useFakeTimers();
    try {
      bufferIncomingText('595983333333', 'Cliente', 'oi', 'msg-1', TENANT_A, vi.fn());
      await vi.advanceTimersByTimeAsync(10_000);
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
        first_message_id: 'msg-preso-1',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startBufferRecoverySweeper((phone) => (combinedText, contactName, lastMessageId, messageCount, resolvedTenant, firstMessageId) => {
      recovered.push({ phone, combinedText, contactName, lastMessageId, messageCount, resolvedTenant, firstMessageId });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      phone: '595984444444',
      combinedText: 'mensagem presa por um restart',
      contactName: 'Cliente Preso',
      lastMessageId: 'msg-preso',
      messageCount: 1,
      firstMessageId: 'msg-preso-1',
    });
    const rows = (supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595984444444');
    expect(rows).toHaveLength(0); // limpa depois de recuperar, não recupera de novo no próximo tick
  });

  // TASK-0172: marcas persistidas ANTES da coluna first_message_id existir
  // não têm esse campo — cai pro last_message_id (mais próximo do correto
  // do que nada), nunca quebra a recuperação.
  it('cai pro last_message_id quando a marca presa é de antes da coluna first_message_id existir', async () => {
    supabase.__tables.pending_message_buffers = [
      {
        tenant_id: 'tenant-a',
        phone: '595984444445',
        texts: ['mensagem presa, formato antigo'],
        contact_name: 'Cliente Antigo',
        last_message_id: 'msg-antigo',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startBufferRecoverySweeper((phone) => (combinedText, contactName, lastMessageId, messageCount, resolvedTenant, firstMessageId) => {
      recovered.push({ phone, firstMessageId });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toEqual([{ phone: '595984444445', firstMessageId: 'msg-antigo' }]);
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

describe('TASK-0388 — corrida entre o timer local e o sweeper de recuperação', () => {
  it('achado real em produção (texto e mídia duplicados pro cliente): sweeper não reprocessa a mesma rajada enquanto o delete da marca persistida do flush local ainda está em andamento', async () => {
    vi.useFakeTimers();
    try {
      // Simula um round-trip lento pro Supabase no delete de
      // `pending_message_buffers` (rede lenta, cold start) — a mesma janela
      // onde o bug real acontecia: `doFlush` já tinha tirado a chave do Map
      // de acumulação, mas o sweeper (intervalo PRÓPRIO, independente deste
      // timer) ainda encontrava a marca no banco e disparava a MESMA rajada
      // de novo.
      const originalFrom = supabase.from.bind(supabase);
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        const builder = originalFrom(table);
        if (table !== 'pending_message_buffers') return builder;
        return {
          ...builder,
          delete: () => {
            const qb: any = builder.delete();
            const originalThen = qb.then.bind(qb);
            const gate = new Promise<void>((resolve) => setTimeout(resolve, 20_050));
            qb.then = (resolve: any, reject: any) => gate.then(() => originalThen(resolve, reject));
            return qb;
          },
        };
      });

      const onFlushLocal = vi.fn();
      bufferIncomingText('595987777777', 'Cliente', 'oi', 'msg-1', TENANT_A, onFlushLocal);

      const onFlushSweep = vi.fn();
      startBufferRecoverySweeper(() => (combinedText) => onFlushSweep(combinedText));

      await vi.advanceTimersByTimeAsync(10); // deixa a marca persistir de verdade (fire-and-forget)

      // t=10000: o timer local de silêncio dispara — doFlush começa, marca
      // `flushing` e fica preso nos ~20s do delete simulado acima.
      await vi.advanceTimersByTimeAsync(9_990);
      expect(onFlushLocal).not.toHaveBeenCalled();

      // t=15010: primeiro tick do sweeper (intervalo de 15s) — no código
      // antigo, a chave já tinha sumido do Map aqui e o sweeper duplicava.
      await vi.advanceTimersByTimeAsync(5_010);
      expect(onFlushSweep).not.toHaveBeenCalled();

      // t=30010: segundo tick do sweeper — o delete simulado ainda não
      // terminou (só em t=30050), continua bloqueado.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(onFlushSweep).not.toHaveBeenCalled();

      // t=30110: o delete real termina (t=30050) — o flush local conclui.
      await vi.advanceTimersByTimeAsync(100);
      expect(onFlushLocal).toHaveBeenCalledTimes(1);
      expect(onFlushLocal).toHaveBeenCalledWith('oi', 'Cliente', 'msg-1', 1, TENANT_A, 'msg-1');

      // t=45110: mais um tick do sweeper, agora com a marca já removida de
      // verdade — nenhum reprocessamento tardio.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(onFlushSweep).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
