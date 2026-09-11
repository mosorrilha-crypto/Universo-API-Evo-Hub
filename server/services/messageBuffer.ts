/**
 * Agrupa mensagens de texto picotadas (2-3 mensagens rápidas seguidas do
 * mesmo número) antes de disparar a resposta automática — espera um período
 * de silêncio antes de processar tudo junto, em vez de responder cada
 * fragmento separadamente (o que denunciaria na hora que é um agente
 * automático). Mesmo princípio do buffer.js do whatsapp-agent-monique.
 *
 * O timer em memória (Map) continua sendo o caminho rápido pro caso comum —
 * sem round-trip de banco no meio da janela de 10s. Achado real em produção
 * (15/08/2026): um restart de deploy no meio dessa janela perdia a mensagem
 * inteira — o timer nunca disparava de novo, e o cliente ficava sem
 * resposta nenhuma, silenciosamente. Cada chamada agora também persiste
 * (melhor esforço, nunca bloqueia o caminho real) uma marca em
 * `pending_message_buffers`; um sweeper periódico (startBufferRecoverySweeper,
 * chamado uma vez no boot do router) recupera qualquer marca cujo horário de
 * disparo já passou e ninguém tratou nesta instância — cobre exatamente o
 * caso do restart no meio da janela.
 */
import { getDb, getPlatformDb } from './db';
import { runWithTenantDbContext } from './tenantDbContext';
import type { ResolvedTenant } from './tenantResolver';

// Dez segundos capturam complementos naturais enviados após a primeira frase
// (por exemplo, "quanto dura?" seguido de "os três"), sem deixar a conversa
// parecer travada para a cliente.
const SILENCE_MS = 10_000;

/** Intervalo do sweeper de recuperação — bem mais espaçado que a janela de silêncio (10s), só existe pra cobrir o caso raro de restart no meio dela. */
const SWEEP_INTERVAL_MS = 15_000;

type FlushCallback = (combinedText: string, contactName: string | undefined, lastMessageId: string, messageCount: number, resolvedTenant: ResolvedTenant, firstMessageId: string) => void;

interface PendingBuffer {
  texts: string[];
  contactName: string | undefined;
  lastMessageId: string;
  /**
   * ID da PRIMEIRA mensagem deste lote — nunca sobrescrito enquanto o
   * mesmo buffer segue acumulando mensagens de rajada. Achado real
   * (Gladys, tenant Monique, 30/08/2026): runExclusive (perPhoneQueue.ts)
   * serializa os ciclos de resposta por telefone, mas um ciclo pode ficar
   * PRESO na fila enquanto o cliente manda mais mensagens — que já são
   * gravadas na hora (recordIncomingMessage roda antes de qualquer
   * buffer/fila). Cortar o histórico pela CONTAGEM de mensagens deste lote
   * (`slice(0, -messageCount)`) supõe que nada mais foi gravado nesse
   * meio-tempo — premissa que essa fila pode violar. Guardar o ID da
   * primeira mensagem do lote permite cortar por IDENTIDADE (tudo antes
   * dela) em vez de por contagem, correto mesmo com mensagens novas
   * chegando enquanto o ciclo espera a vez.
   */
  firstMessageId: string;
  /** Tenant resolvido (Bloco 2.B) da mensagem mais recente do lote — usado ao disparar a resposta automática pro grupo inteiro. */
  resolvedTenant: ResolvedTenant;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, PendingBuffer>();

// Achado real em produção (mensagens/mídia duplicadas pro cliente, tenant
// Monique): `doFlush` removia a chave de `buffers` de forma síncrona, ANTES
// de esperar `deletePersistedBuffer` (round-trip real pro Supabase)
// terminar. O sweeper de recuperação roda num intervalo PRÓPRIO
// (SWEEP_INTERVAL_MS), independente deste timer, e sua única proteção
// contra concorrência era checar `buffers.has(key)` — com a chave já
// removida do Map ANTES do delete no banco ter sido confirmado, uma
// varredura que caísse bem nessa janela (rede lenta, cold start do
// Supabase) encontrava a marca ainda persistida (`flush_at` já passado) e a
// chave já ausente do Map, disparando a MESMA rajada de novo — reenviando
// texto e qualquer mídia (ex.: catálogo) uma segunda vez pro cliente. Este
// Set marca as chaves cujo `doFlush` já começou mas o delete persistido
// ainda não terminou; o sweeper passa a checar as duas fontes.
const flushing = new Set<string>();

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

async function doFlush(key: string, phone: string, buffer: PendingBuffer, onFlush: FlushCallback) {
  // Remove já da Map de acumulação (uma mensagem nova que chegue agora deve
  // abrir um buffer novo, nunca se juntar a este que já está sendo
  // processado) — mas marca em `flushing` até o delete persistido terminar,
  // pra manter o sweeper bloqueado durante esse round-trip (ver comentário
  // acima de `flushing`).
  buffers.delete(key);
  flushing.add(key);
  // A marca persistida precisa ser removida ANTES de iniciar o processamento.
  // Assim um sweeper de recuperação em outra instância não reenvia a mesma
  // pergunta enquanto esta resposta já está sendo gerada.
  try {
    await deletePersistedBuffer(buffer.resolvedTenant.tenantId, phone);
  } catch (err: any) {
    console.warn(`⚠️  [Buffer de rajada] Falha ao remover marca persistida pra ${phone}:`, err.message);
  } finally {
    flushing.delete(key);
  }
  onFlush(buffer.texts.join('\n'), buffer.contactName, buffer.lastMessageId, buffer.texts.length, buffer.resolvedTenant, buffer.firstMessageId);
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
    firstMessageId: existing?.firstMessageId || messageId,
    resolvedTenant,
    timer: setTimeout(() => void doFlush(key, phone, buffer, onFlush), SILENCE_MS),
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
      const db = getPlatformDb();
      const nowIso = new Date().toISOString();
      const { data, error } = await db.from('pending_message_buffers').select('*').lt('flush_at', nowIso);
      if (error || !data) return;
      for (const row of data as any[]) {
        const key = bufferKey(row.tenant_id, row.phone);
        // já em andamento nesta mesma instância, não duplica — `flushing`
        // cobre o round-trip do delete persistido de um `doFlush` já
        // iniciado (ver comentário acima de `flushing`), não só o Map de
        // acumulação.
        if (buffers.has(key) || flushing.has(key)) continue;
        await runWithTenantDbContext({ tenantId: row.tenant_id, source: 'job' }, async () => {
          await deletePersistedBuffer(row.tenant_id, row.phone);
          const texts: string[] = Array.isArray(row.texts) ? row.texts : [];
          if (!texts.length) return;
          console.warn(`⚠️  [Buffer de rajada] Recuperando marca presa de um restart anterior pra ${row.phone} (tenant=${row.tenant_id}).`);
          // first_message_id pode não existir em marcas persistidas antes
          // dessa coluna (TASK-0172) — cair pro last_message_id nesse caso
          // raro (só acontece pra uma marca presa desde ANTES do deploy
          // desta correção) é mais próximo do correto do que nada.
          onFlush(row.phone)(texts.join('\n'), row.contact_name ?? undefined, row.last_message_id, texts.length, row.resolved_tenant as ResolvedTenant, row.first_message_id || row.last_message_id);
        });
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
