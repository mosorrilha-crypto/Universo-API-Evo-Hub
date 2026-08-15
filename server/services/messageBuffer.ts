/**
 * Agrupa mensagens de texto picotadas (2-3 mensagens rápidas seguidas do
 * mesmo número) antes de disparar a resposta automática — espera um período
 * de silêncio antes de processar tudo junto, em vez de responder cada
 * fragmento separadamente (o que denunciaria na hora que é um agente
 * automático). Mesmo princípio do buffer.js do whatsapp-agent-monique.
 *
 * O timer em memória (Map) continua sendo o caminho rápido pro caso comum —
 * sem round-trip de banco no meio da janela de 6s. Achado real em produção
 * (15/08/2026): um restart de deploy no meio dessa janela perdia a mensagem
 * inteira — o timer nunca disparava de novo, e o cliente ficava sem
 * resposta nenhuma, silenciosamente. Cada chamada agora também persiste
 * (melhor esforço, nunca bloqueia o caminho real) uma marca em
 * `pending_message_buffers`; um sweeper periódico (startBufferRecoverySweeper,
 * chamado uma vez no boot do router) recupera qualquer marca cujo horário de
 * disparo já passou e ninguém tratou nesta instância — cobre exatamente o
 * caso do restart no meio da janela.
 */
import { getDb } from './db';
import type { ResolvedTenant } from './tenantResolver';

const SILENCE_MS = 6000;

/** Intervalo do sweeper de recuperação — bem mais espaçado que a janela de silêncio (6s), só existe pra cobrir o caso raro de restart no meio dela. */
const SWEEP_INTERVAL_MS = 15_000;

type FlushCallback = (combinedText: string, contactName: string | undefined, lastMessageId: string, messageCount: number, resolvedTenant: ResolvedTenant) => void;

interface PendingBuffer {
  texts: string[];
  contactName: string | undefined;
  lastMessageId: string;
  /** Tenant resolvido (Bloco 2.B) da mensagem mais recente do lote — usado ao disparar a resposta automática pro grupo inteiro. */
  resolvedTenant: ResolvedTenant;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, PendingBuffer>();

// Achado real ao adicionar persistência: a chave era só `phone`, sem
// tenant_id — o mesmo número de telefone falando com dois tenants
// diferentes da plataforma (cenário real e possível) colidia num único
// buffer, arriscando misturar mensagens de conversas de negócios diferentes
// sob o resolvedTenant errado. Corrigido junto (chave composta), não é uma
// mudança de comportamento carregada de propósito nesta tarefa, só uma
// correção pequena e segura enquanto o arquivo já estava sendo reescrito.
function bufferKey(tenantId: string, phone: string): string {
  return `${tenantId}:${phone}`;
}

function doFlush(key: string, phone: string, buffer: PendingBuffer, onFlush: FlushCallback) {
  buffers.delete(key);
  onFlush(buffer.texts.join('\n'), buffer.contactName, buffer.lastMessageId, buffer.texts.length, buffer.resolvedTenant);
  deletePersistedBuffer(buffer.resolvedTenant.tenantId, phone).catch((err: any) => {
    console.warn(`⚠️  [Buffer de rajada] Falha ao remover marca persistida pra ${phone}:`, err.message);
  });
}

export function bufferIncomingText(
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
  const buffer: PendingBuffer = {
    texts,
    contactName: contactName || existing?.contactName,
    lastMessageId: messageId,
    resolvedTenant,
    timer: setTimeout(() => doFlush(key, phone, buffer, onFlush), SILENCE_MS),
  };
  buffers.set(key, buffer);

  persistBuffer(phone, buffer).catch((err: any) => {
    console.warn(`⚠️  [Buffer de rajada] Falha ao persistir marca pra ${phone}:`, err.message);
  });
}

async function persistBuffer(phone: string, buffer: PendingBuffer): Promise<void> {
  const db = getDb();
  const flushAt = new Date(Date.now() + SILENCE_MS).toISOString();
  const { error } = await db.from('pending_message_buffers').upsert(
    {
      tenant_id: buffer.resolvedTenant.tenantId,
      phone,
      texts: buffer.texts,
      contact_name: buffer.contactName ?? null,
      last_message_id: buffer.lastMessageId,
      resolved_tenant: buffer.resolvedTenant,
      flush_at: flushAt,
    },
    { onConflict: 'tenant_id,phone' }
  );
  if (error) throw new Error(error.message);
}

async function deletePersistedBuffer(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  await db.from('pending_message_buffers').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

/**
 * Varre `pending_message_buffers` por marcas cujo horário de disparo já
 * passou e ninguém tratou NESTA instância (não estão no Map em memória) —
 * só acontece de verdade depois de um restart no meio da janela de
 * silêncio. Chamada uma vez no boot (createWebhooksRouter) e depois a cada
 * SWEEP_INTERVAL_MS. Melhor esforço: uma falha aqui não pode travar o
 * processo, só significa que a recuperação tenta de novo no próximo tick.
 */
export function startBufferRecoverySweeper(onFlush: (phone: string) => FlushCallback): void {
  const sweep = async () => {
    try {
      const db = getDb();
      const nowIso = new Date().toISOString();
      const { data, error } = await db.from('pending_message_buffers').select('*').lt('flush_at', nowIso);
      if (error || !data) return;
      for (const row of data as any[]) {
        const key = bufferKey(row.tenant_id, row.phone);
        if (buffers.has(key)) continue; // já em andamento nesta mesma instância, não duplica
        await deletePersistedBuffer(row.tenant_id, row.phone);
        const texts: string[] = Array.isArray(row.texts) ? row.texts : [];
        if (!texts.length) continue;
        console.warn(`⚠️  [Buffer de rajada] Recuperando marca presa de um restart anterior pra ${row.phone} (tenant=${row.tenant_id}).`);
        onFlush(row.phone)(texts.join('\n'), row.contact_name ?? undefined, row.last_message_id, texts.length, row.resolved_tenant as ResolvedTenant);
      }
    } catch (err: any) {
      console.warn('⚠️  [Buffer de rajada] Falha na varredura de recuperação:', err.message);
    }
  };
  sweep();
  // unref() — nunca deve, sozinho, impedir o processo de encerrar (nem em
  // produção nem em teste: várias suítes constroem o router direto, sem
  // subir um servidor de verdade por trás pra manter o processo vivo).
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
