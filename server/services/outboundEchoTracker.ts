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

/** Janela de tolerância entre "mandamos algo" e "o eco chegou de volta" — generosa o bastante pra cobrir latência normal do webhook, curta o bastante pra não confundir uma coincidência de texto muito depois. */
const ECHO_WINDOW_MS = 30_000;

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
    console.warn(`⚠️  [Eco de envio] Falha ao registrar marca pendente pra ${phone}:`, error.message);
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
