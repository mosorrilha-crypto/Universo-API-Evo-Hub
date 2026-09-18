/**
 * TASK-0430 — achado real de audit (tenant Monique, cliente "Carmen
 * Bareiro"): diferente do texto (messageBuffer.ts, agrupa mensagens
 * picotadas com ~10s de silêncio antes de responder), o áudio não tinha
 * NENHUM agrupamento — cada nota de voz, assim que terminava de transcrever
 * (fila global única de transcrição, transcriptionQueue.ts), disparava
 * sozinha um ciclo completo e independente de resposta automática. Uma
 * cliente que mandou 7 áudios em ~3 minutos e meio gerou efetivamente 5-6
 * respostas separadas, sem nenhuma saber que a cliente já tinha seguido em
 * frente enquanto esperava na fila — terminando em 3 despedidas quase
 * idênticas em sequência (o revisor de repetição, replySafetyGate.ts, é
 * baseado em sobreposição literal de palavras e não pegou, já que cada
 * despedida saiu reformulada, seguindo a própria instrução do agente de
 * variar a redação pra não soar como script).
 *
 * Mesmo princípio e mesma janela de silêncio do buffer de texto, mas
 * DELIBERADAMENTE independente dele (Map/tabela própria, nunca mistura com
 * pending_message_buffers) — evita qualquer risco de um flush de áudio
 * "vencer" um flush de texto (ou vice-versa) e rodar com um conjunto de
 * funcionalidades diferente (ex: calendarConfig, mensagem de 1º contato,
 * orientação de operador pendente — hoje só o caminho de texto cobre isso).
 * Unificar de verdade os dois caminhos é uma tarefa maior, fora do escopo
 * deste achado.
 */
import { getDb, getPlatformDb } from './db';
import { runWithTenantDbContext } from './tenantDbContext';
import { isGenerating } from './generatingLock';
import type { ResolvedTenant } from './tenantResolver';

const SILENCE_MS = 10_000;
const SWEEP_INTERVAL_MS = 15_000;

/** TASK-0431 — mesmo princípio de messageBuffer.ts: adia o flush enquanto uma resposta pro mesmo telefone ainda está sendo gerada, em vez de disparar por conta própria e virar um ciclo independente e redundante. */
const GENERATION_WAIT_RETRY_MS = 2_000;
const MAX_GENERATION_WAIT_MS = 3 * 60_000;

type FlushCallback = (combinedText: string, contactName: string | undefined, lastMessageId: string, messageCount: number, resolvedTenant: ResolvedTenant, firstMessageId: string) => void;

interface PendingAudioBuffer {
  texts: string[];
  contactName: string | undefined;
  lastMessageId: string;
  firstMessageId: string;
  resolvedTenant: ResolvedTenant;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, PendingAudioBuffer>();
const flushing = new Set<string>();

function bufferKey(tenantId: string, phone: string): string {
  return `${tenantId}:${phone}`;
}

async function doFlush(key: string, phone: string, buffer: PendingAudioBuffer, onFlush: FlushCallback, waitStartedAt: number = Date.now()) {
  if (isGenerating(buffer.resolvedTenant.tenantId, phone) && Date.now() - waitStartedAt < MAX_GENERATION_WAIT_MS) {
    const retryBuffer: PendingAudioBuffer = { ...buffer, timer: setTimeout(() => void doFlush(key, phone, retryBuffer, onFlush, waitStartedAt), GENERATION_WAIT_RETRY_MS) };
    buffers.set(key, retryBuffer);
    return;
  }
  buffers.delete(key);
  flushing.add(key);
  try {
    await deletePersistedBuffer(buffer.resolvedTenant.tenantId, phone);
  } catch (err: any) {
    console.warn(`⚠️  [Buffer de áudio] Falha ao remover marca persistida pra ${phone}:`, err.message);
  } finally {
    flushing.delete(key);
  }
  onFlush(buffer.texts.join('\n'), buffer.contactName, buffer.lastMessageId, buffer.texts.length, buffer.resolvedTenant, buffer.firstMessageId);
}

/**
 * Registra a transcrição de mais um áudio pro mesmo número — se já existir
 * um buffer em aberto (outro áudio, ou o mesmo cliente mandando vários em
 * rajada), acumula e reinicia a janela de silêncio em vez de disparar uma
 * resposta por áudio.
 */
export function bufferIncomingAudioText(
  phone: string,
  contactName: string | undefined,
  text: string,
  messageId: string,
  resolvedTenant: ResolvedTenant,
  onFlush: FlushCallback
) {
  const key = bufferKey(resolvedTenant.tenantId, phone);
  const existing = buffers.get(key);
  if (existing) clearTimeout(existing.timer);

  const texts = existing ? [...existing.texts, text] : [text];
  const buffer: PendingAudioBuffer = {
    texts,
    contactName: contactName || existing?.contactName,
    lastMessageId: messageId,
    firstMessageId: existing?.firstMessageId || messageId,
    resolvedTenant,
    timer: setTimeout(() => void doFlush(key, phone, buffer, onFlush), SILENCE_MS),
  };
  buffers.set(key, buffer);

  persistBuffer(phone, buffer).catch((err: any) => {
    console.warn(`⚠️  [Buffer de áudio] Falha ao persistir marca pra ${phone}:`, err.message);
  });
}

async function persistBuffer(phone: string, buffer: PendingAudioBuffer): Promise<void> {
  const db = getDb();
  const flushAt = new Date(Date.now() + SILENCE_MS).toISOString();
  const { error } = await db.from('pending_audio_buffers').upsert(
    {
      tenant_id: buffer.resolvedTenant.tenantId,
      phone,
      texts: buffer.texts,
      contact_name: buffer.contactName ?? null,
      last_message_id: buffer.lastMessageId,
      first_message_id: buffer.firstMessageId,
      resolved_tenant: buffer.resolvedTenant,
      flush_at: flushAt,
    },
    { onConflict: 'tenant_id,phone' }
  );
  if (error) throw new Error(error.message);
}

async function deletePersistedBuffer(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  await db.from('pending_audio_buffers').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

/**
 * Mesmo princípio de takePendingBufferTexts (messageBuffer.ts, TASK-0418):
 * retira (sem disparar o flush normal) um buffer de áudio pendente pro mesmo
 * tenant/telefone, se existir — usado por quem já está gerando uma resposta
 * pro mesmo número e quer absorver um áudio que chegou nesse meio-tempo em
 * vez de deixá-lo disparar sua própria rodada separada mais tarde.
 */
export function takePendingAudioBufferTexts(tenantId: string, phone: string): { texts: string[]; lastMessageId: string } | null {
  const key = bufferKey(tenantId, phone);
  const existing = buffers.get(key);
  if (!existing) return null;
  clearTimeout(existing.timer);
  buffers.delete(key);
  deletePersistedBuffer(tenantId, phone).catch((err: any) => {
    console.warn(`⚠️  [Buffer de áudio] Falha ao remover marca persistida (absorção) pra ${phone}:`, err.message);
  });
  return { texts: existing.texts, lastMessageId: existing.lastMessageId };
}

/** Mesmo mecanismo de recuperação pós-restart de messageBuffer.ts, aplicado à tabela própria do áudio. Chamado uma vez no boot (startTranscriptionWorker). */
export function startAudioBufferRecoverySweeper(onFlush: (phone: string) => FlushCallback): void {
  const sweep = async () => {
    try {
      const db = getPlatformDb();
      const nowIso = new Date().toISOString();
      const { data, error } = await db.from('pending_audio_buffers').select('*').lt('flush_at', nowIso);
      if (error || !data) return;
      for (const row of data as any[]) {
        const key = bufferKey(row.tenant_id, row.phone);
        if (buffers.has(key) || flushing.has(key)) continue;
        await runWithTenantDbContext({ tenantId: row.tenant_id, source: 'job' }, async () => {
          await deletePersistedBuffer(row.tenant_id, row.phone);
          const texts: string[] = Array.isArray(row.texts) ? row.texts : [];
          if (!texts.length) return;
          console.warn(`⚠️  [Buffer de áudio] Recuperando marca presa de um restart anterior pra ${row.phone} (tenant=${row.tenant_id}).`);
          onFlush(row.phone)(texts.join('\n'), row.contact_name ?? undefined, row.last_message_id, texts.length, row.resolved_tenant as ResolvedTenant, row.first_message_id || row.last_message_id);
        });
      }
    } catch (err: any) {
      console.warn('⚠️  [Buffer de áudio] Falha na varredura de recuperação:', err.message);
    }
  };
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
