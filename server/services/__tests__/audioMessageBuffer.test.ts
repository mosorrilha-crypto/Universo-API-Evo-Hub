/**
 * TASK-0430 — achado real (tenant Monique, cliente "Carmen Bareiro"): o
 * áudio não tinha nenhum agrupamento — cada nota de voz, assim que
 * terminava de transcrever, disparava seu próprio ciclo completo de
 * resposta. audioMessageBuffer.ts aplica o mesmo princípio do buffer de
 * texto (messageBuffer.ts) ao caminho de áudio, deliberadamente numa
 * tabela/Map próprios. Cobertura espelha messageBuffer.test.ts: agrupamento
 * normal, isolamento por tenant, persistência/recuperação pós-restart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { bufferIncomingAudioText, startAudioBufferRecoverySweeper, takePendingAudioBufferTexts } from '../audioMessageBuffer';
import type { ResolvedTenant } from '../tenantResolver';

const TENANT_A: ResolvedTenant = { tenantId: 'tenant-a', provider: 'evolution', evolutionInstanceName: 'inst-a' };
const TENANT_B: ResolvedTenant = { tenantId: 'tenant-b', provider: 'evolution', evolutionInstanceName: 'inst-b' };

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('bufferIncomingAudioText', () => {
  it('agrupa transcrições de áudio em rajada e dispara o callback uma vez só, depois do silêncio', async () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      bufferIncomingAudioText('595981111111', 'Cliente', 'primeiro áudio', 'audio-1', TENANT_A, onFlush);
      bufferIncomingAudioText('595981111111', 'Cliente', 'segundo áudio', 'audio-2', TENANT_A, onFlush);
      bufferIncomingAudioText('595981111111', 'Cliente', 'terceiro áudio', 'audio-3', TENANT_A, onFlush);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('primeiro áudio\nsegundo áudio\nterceiro áudio', 'Cliente', 'audio-3', 3, TENANT_A, 'audio-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('nunca mistura com o buffer de texto (tabela/Map próprios) mesmo pro mesmo tenant/telefone', async () => {
    bufferIncomingAudioText('595981111112', 'Cliente', 'áudio', 'audio-1', TENANT_A, vi.fn());
    await new Promise((r) => setTimeout(r, 10));
    expect((supabase.__tables.pending_message_buffers || []).filter((r: any) => r.phone === '595981111112')).toHaveLength(0);
    expect((supabase.__tables.pending_audio_buffers || []).filter((r: any) => r.phone === '595981111112')).toHaveLength(1);
  });

  it('isolamento por tenant — o mesmo telefone falando com dois tenants não colide num buffer só', async () => {
    vi.useFakeTimers();
    try {
      const onFlushA = vi.fn();
      const onFlushB = vi.fn();
      bufferIncomingAudioText('595981234567', 'Cliente', 'áudio tenant A', 'audio-a', TENANT_A, onFlushA);
      bufferIncomingAudioText('595981234567', 'Cliente', 'áudio tenant B', 'audio-b', TENANT_B, onFlushB);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFlushA).toHaveBeenCalledWith('áudio tenant A', 'Cliente', 'audio-a', 1, TENANT_A, 'audio-a');
      expect(onFlushB).toHaveBeenCalledWith('áudio tenant B', 'Cliente', 'audio-b', 1, TENANT_B, 'audio-b');
    } finally {
      vi.useRealTimers();
    }
  });

  it('persiste uma marca em pending_audio_buffers ao bufferizar (melhor esforço, fire-and-forget)', async () => {
    bufferIncomingAudioText('595982222222', 'Cliente', 'áudio', 'audio-1', TENANT_A, vi.fn());
    await new Promise((r) => setTimeout(r, 10));
    const rows = (supabase.__tables.pending_audio_buffers || []).filter((r: any) => r.phone === '595982222222');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: 'tenant-a', phone: '595982222222', texts: ['áudio'], last_message_id: 'audio-1', first_message_id: 'audio-1' });
  });

  it('remove a marca persistida depois de um flush normal (timer em memória, sem precisar do sweeper)', async () => {
    vi.useFakeTimers();
    try {
      bufferIncomingAudioText('595983333333', 'Cliente', 'áudio', 'audio-1', TENANT_A, vi.fn());
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }
    await new Promise((r) => setTimeout(r, 10));
    const rows = (supabase.__tables.pending_audio_buffers || []).filter((r: any) => r.phone === '595983333333');
    expect(rows).toHaveLength(0);
  });
});

describe('startAudioBufferRecoverySweeper', () => {
  it('achado real: recupera um lote de áudio preso de um restart anterior (flush_at já passou, nada em memória nesta instância)', async () => {
    supabase.__tables.pending_audio_buffers = [
      {
        tenant_id: 'tenant-a',
        phone: '595984444444',
        texts: ['áudio preso por um restart'],
        contact_name: 'Cliente Preso',
        last_message_id: 'audio-preso',
        first_message_id: 'audio-preso-1',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startAudioBufferRecoverySweeper((phone) => (combinedText, contactName, lastMessageId, messageCount, resolvedTenant, firstMessageId) => {
      recovered.push({ phone, combinedText, contactName, lastMessageId, messageCount, resolvedTenant, firstMessageId });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      phone: '595984444444',
      combinedText: 'áudio preso por um restart',
      contactName: 'Cliente Preso',
      lastMessageId: 'audio-preso',
      messageCount: 1,
      firstMessageId: 'audio-preso-1',
    });
    const rows = (supabase.__tables.pending_audio_buffers || []).filter((r: any) => r.phone === '595984444444');
    expect(rows).toHaveLength(0);
  });

  it('ignora marca cujo flush_at ainda não chegou (não é recuperação, é um lote normal em andamento)', async () => {
    supabase.__tables.pending_audio_buffers = [
      {
        tenant_id: 'tenant-a',
        phone: '595985555555',
        texts: ['ainda dentro da janela'],
        contact_name: null,
        last_message_id: 'audio-futuro',
        first_message_id: 'audio-futuro',
        resolved_tenant: TENANT_A,
        flush_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    const recovered: any[] = [];
    startAudioBufferRecoverySweeper((phone) => (combinedText) => {
      recovered.push({ phone, combinedText });
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(recovered).toHaveLength(0);
    const rows = (supabase.__tables.pending_audio_buffers || []).filter((r: any) => r.phone === '595985555555');
    expect(rows).toHaveLength(1);
  });
});

describe('takePendingAudioBufferTexts', () => {
  it('retorna null quando não há lote pendente pra esse tenant/telefone', () => {
    expect(takePendingAudioBufferTexts('tenant-a', '595989999999')).toBeNull();
  });

  it('retira o lote pendente (textos + lastMessageId), cancela o timer e não dispara mais o onFlush original', async () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      bufferIncomingAudioText('595988888888', 'Cliente', 'primeiro', 'audio-1', TENANT_A, onFlush);
      bufferIncomingAudioText('595988888888', 'Cliente', 'segundo', 'audio-2', TENANT_A, onFlush);

      const taken = takePendingAudioBufferTexts('tenant-a', '595988888888');
      expect(taken).toEqual({ texts: ['primeiro', 'segundo'], lastMessageId: 'audio-2' });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onFlush).not.toHaveBeenCalled();
      expect(takePendingAudioBufferTexts('tenant-a', '595988888888')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
