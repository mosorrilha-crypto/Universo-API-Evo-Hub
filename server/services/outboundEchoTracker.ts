/**
 * Distingue "eco da nossa própria mensagem" de "mensagem mandada direto do
 * celular conectado" quando chega um evento fromMe:true da Evolution API —
 * ela espelha TODA atividade do número, inclusive nosso próprio envio via
 * API. Sem essa distinção, ou duplicamos toda mensagem que já mandamos pelo
 * painel/IA, ou ignoramos pra sempre qualquer coisa que o operador manda
 * direto do WhatsApp (achado real: texto e mídia mandados assim ficavam
 * invisíveis pro painel E pro contexto futuro do agente).
 *
 * Ver supabase/migrations/0030_pending_outbound_echoes.sql.
 */
import { getDb } from './db';

/**
 * Janela de tolerância entre "mandamos algo" e "o eco chegou de volta" —
 * generosa o bastante pra cobrir latência normal do webhook, curta o
 * bastante pra não confundir uma coincidência de texto muito depois.
 * Achado real (15/08/2026): 30s achava curto demais pra latência real
 * observada em produção (webhook da Evolution API pode demorar bem mais que
 * isso sob carga) — uma marca pendente "expirava" da janela de match antes
 * do eco de verdade chegar, e o eco tardio virava (incorretamente) uma
 * mensagem nova "mandada direto do celular", duplicando o que já tínhamos
 * gravado. Aumentado pra 2min; a garbage collection abaixo evita que marcas
 * nunca reclamadas (ex: envio que falhou silenciosamente, sem eco nenhum
 * chegar) fiquem acumulando pra sempre e um dia colidam por coincidência com
 * uma mensagem futura de texto igual.
 */
const ECHO_WINDOW_MS = 120_000;

/** Teto pra marca pendente nunca reclamada (envio falhou/eco nunca chegou) — limpa no mesmo select-then-delete de consumePendingEcho, sem precisar de job separado. */
const STALE_ECHO_MS = 10 * 60_000;

export type OutboundEchoType = 'text' | 'audio' | 'image' | 'file';

/**
 * Chamado logo depois de gravar uma mensagem enviada de verdade — registra
 * que um eco fromMe:true correspondente é esperado e deve ser descartado,
 * não tratado como mensagem nova. Nunca lança (falha aqui não pode derrubar
 * o envio real da mensagem); pior caso de falha é o eco cair no caminho de
 * "mandado direto do celular" e gerar uma duplicata ocasional.
 */
export async function registerPendingEcho(tenantId: string, phone: string, type: OutboundEchoType, text?: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('pending_outbound_echoes').insert({ tenant_id: tenantId, phone, type, text: text ?? null, created_at: new Date().toISOString() });
  if (error) {
    console.warn('⚠️  [Eco de envio] Falha ao registrar marca pendente:', { phone, message: error.message });
  }
}

/**
 * Chamado quando chega um evento fromMe:true — tenta "consumir" uma marca
 * pendente correspondente (mesmo tenant/telefone/tipo, e mesmo texto exato
 * quando for texto). Retorna true se achou e removeu (eco confirmado de algo
 * que já mandamos, descarta o evento); false se não achou (mandado direto do
 * celular, precisa virar mensagem nova).
 */
export async function consumePendingEcho(tenantId: string, phone: string, type: OutboundEchoType, text?: string): Promise<boolean> {
  const db = getDb();
  await cleanupStaleEchoes(tenantId);
  const sinceIso = new Date(Date.now() - ECHO_WINDOW_MS).toISOString();
  let query = db
    .from('pending_outbound_echoes')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('type', type)
    .gte('created_at', sinceIso);
  if (type === 'text') {
    query = query.eq('text', text ?? '');
  }
  const { data, error } = await query;
  if (error) {
    // Na dúvida, trata como mensagem nova — pior caso é uma duplicata
    // ocasional, nunca perder uma mensagem de vez.
    console.warn(`⚠️  [Eco de envio] Falha ao checar marca pendente pra ${phone}:`, error.message);
    return false;
  }
  const match = (data as { id: string }[] | null)?.[0];
  if (!match) return false;
  const { error: deleteError } = await db.from('pending_outbound_echoes').delete().eq('id', match.id);
  if (deleteError) {
    console.warn(`⚠️  [Eco de envio] Falha ao remover marca pendente ${match.id}:`, deleteError.message);
  }
  return true;
}

/**
 * Melhor esforço, roda a cada chamada de consumePendingEcho — apaga marcas
 * nunca reclamadas há mais de STALE_ECHO_MS (o eco de verdade nunca chegou,
 * geralmente porque o envio original falhou silenciosamente). Nunca lança:
 * falha aqui não pode travar o processamento real do evento fromMe.
 */
async function cleanupStaleEchoes(tenantId: string): Promise<void> {
  const db = getDb();
  const staleBeforeIso = new Date(Date.now() - STALE_ECHO_MS).toISOString();
  const { error } = await db.from('pending_outbound_echoes').delete().eq('tenant_id', tenantId).lt('created_at', staleBeforeIso);
  if (error) {
    console.warn(`⚠️  [Eco de envio] Falha ao limpar marcas pendentes antigas (tenant=${tenantId}):`, error.message);
  }
}
