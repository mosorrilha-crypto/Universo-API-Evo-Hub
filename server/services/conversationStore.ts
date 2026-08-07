/**
 * Histórico de conversas reais de WhatsApp — alimenta a caixa de mensagens
 * do frontend (WhatsAppLeadsSim) com dados de verdade em vez do mock local.
 * Migrado do Map em memória + JSON no Supabase Storage (Bloco 2.A) pras
 * tabelas Postgres `conversations`/`messages`, particionadas por tenant_id
 * — ver supabase/migrations/0001_multi_tenant_schema.sql.
 */
import { getDb } from './db';

export interface StoredMessage {
  id: string;
  sender: 'lead' | 'agent';
  type: 'text' | 'audio' | 'image' | 'file';
  text?: string;
  timestamp: string;
}

export interface GeoRestriction {
  detectedAt: string;
  country: string;
  reason: string;
}

export interface StoredConversation {
  phone: string;
  name?: string;
  messages: StoredMessage[];
  updatedAt: string;
  geoRestriction?: GeoRestriction;
}

/** Infere o país a partir do prefixo do telefone (E.164 sem "+") — só pra exibir no painel, não afeta lógica de envio. */
export function inferCountryFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55')) return 'Brasil';
  if (digits.startsWith('595')) return 'Paraguay';
  if (digits.startsWith('54')) return 'Argentina';
  return 'Desconhecido';
}

type ConversationRow = {
  id: string;
  phone: string;
  name: string | null;
  updated_at: string;
  geo_restriction: GeoRestriction | null;
  messages?: MessageRow[];
};

type MessageRow = {
  id: string;
  sender: 'lead' | 'agent';
  type: StoredMessage['type'];
  text: string | null;
  created_at: string;
};

function toStoredConversation(row: ConversationRow): StoredConversation {
  return {
    phone: row.phone,
    name: row.name || undefined,
    updatedAt: row.updated_at,
    geoRestriction: row.geo_restriction || undefined,
    messages: (row.messages || [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ id: m.id, sender: m.sender, type: m.type, text: m.text || undefined, timestamp: m.created_at })),
  };
}

const CONVERSATION_WITH_MESSAGES = '*, messages(id, sender, type, text, created_at)';

async function getOrCreateConversationRow(tenantId: string, phone: string, name?: string): Promise<{ id: string }> {
  const db = getDb();
  const { data: existing } = await db
    .from('conversations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    if (name && !existing.name) {
      await db.from('conversations').update({ name }).eq('id', existing.id);
    }
    return existing;
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({ tenant_id: tenantId, phone, name: name || null })
    .select('id')
    .single();
  if (error) throw error;
  return created;
}

export interface AdReferral {
  ctwaClid?: string;
  adSourceId?: string;
  adHeadline?: string;
}

/**
 * Grava o `ctwa_clid` (clique no anúncio "Clique para WhatsApp") na
 * conversa, uma única vez — é o clique que originou a conversa, nunca deve
 * ser sobrescrito por mensagens posteriores sem referral. Usado pelo Meta
 * Conversions API (Epic 4.5.6) pra amarrar eventos de conversão ao anúncio
 * real; sem isso gravado, o CAPI nunca dispara pra essa conversa (nunca
 * manda atribuição incompleta/inventada).
 */
export async function attachAdReferralIfMissing(tenantId: string, phone: string, referral: AdReferral | undefined): Promise<void> {
  if (!referral?.ctwaClid) return;
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const { data: existing } = await db.from('conversations').select('ctwa_clid').eq('id', conv.id).maybeSingle();
  if (existing?.ctwa_clid) return;
  await db
    .from('conversations')
    .update({ ctwa_clid: referral.ctwaClid, ad_source_id: referral.adSourceId || null, ad_headline: referral.adHeadline || null })
    .eq('id', conv.id);
}

/** ctwa_clid gravado pra essa conversa, se algum dia veio de um anúncio — null caso contrário (nunca inventar). */
export async function getConversationCtwaClid(tenantId: string, phone: string): Promise<string | null> {
  const db = getDb();
  const { data } = await db.from('conversations').select('ctwa_clid').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  return data?.ctwa_clid || null;
}

export async function recordIncomingMessage(
  tenantId: string,
  phone: string,
  name: string | undefined,
  message: Omit<StoredMessage, 'id' | 'sender'>,
  customId?: string
): Promise<StoredConversation> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone, name);
  const id = customId || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db.from('messages').insert({ id, tenant_id: tenantId, conversation_id: conv.id, sender: 'lead', type: message.type, text: message.text ?? null });
  if (error) {
    // Achado consultando uma lead real com ctwa_clid gravado mas 0 mensagens:
    // este erro só era logado, nunca relançado — o try/catch em webhooks.ts
    // que desmarca a mensagem em idempotency.ts pra permitir reentrega da
    // Meta nunca via a falha, então a mensagem do lead ficava marcada como
    // "processada" pra sempre sem nunca ter sido de fato salva. Relança pra
    // que a reentrega funcione de verdade.
    console.error(`❌ [Conversas] tenant=${tenantId} falha ao gravar mensagem RECEBIDA de ${phone} (id=${id}) — mensagem do lead perdida do histórico:`, error.message);
    throw new Error(`Falha ao gravar mensagem recebida: ${error.message}`);
  }
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conv.id);
  return (await getConversation(tenantId, phone))!;
}

export async function recordOutgoingMessage(tenantId: string, phone: string, message: Omit<StoredMessage, 'id' | 'sender'>): Promise<StoredConversation> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const id = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db.from('messages').insert({ id, tenant_id: tenantId, conversation_id: conv.id, sender: 'agent', type: message.type, text: message.text ?? null });
  if (error) {
    // Mesmo bug do recordIncomingMessage (ver comentário lá): engolir o erro
    // aqui faz o chamador (ex: triggerAutoReply em webhooks.ts) achar que a
    // resposta do agente foi salva quando não foi — relança pra que o
    // try/catch de quem chama trate de verdade (ex: registrar escalonamento).
    console.error(`❌ [Conversas] tenant=${tenantId} falha ao gravar mensagem ENVIADA pra ${phone} (id=${id}) — resposta do agente perdida do histórico:`, error.message);
    throw new Error(`Falha ao gravar mensagem enviada: ${error.message}`);
  }
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conv.id);
  return (await getConversation(tenantId, phone))!;
}

/** Atualiza o texto de uma mensagem já registrada (ex: placeholder de áudio → transcrição real). */
export async function updateMessageText(tenantId: string, phone: string, id: string, newText: string): Promise<void> {
  const db = getDb();
  await db.from('messages').update({ text: newText }).eq('tenant_id', tenantId).eq('id', id);
  const { data: existing } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (existing) await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', existing.id);
}

export async function listConversations(tenantId: string): Promise<StoredConversation[]> {
  const db = getDb();
  const { data, error } = await db
    .from('conversations')
    .select(CONVERSATION_WITH_MESSAGES)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as ConversationRow[]).map(toStoredConversation);
}

export async function getConversation(tenantId: string, phone: string): Promise<StoredConversation | undefined> {
  const db = getDb();
  const { data } = await db
    .from('conversations')
    .select(CONVERSATION_WITH_MESSAGES)
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();
  return data ? toStoredConversation(data as unknown as ConversationRow) : undefined;
}

/**
 * Marca a conversa como bloqueada por restrição geográfica da Meta (erro
 * 130497 — negócio ainda não passou pela Verificação de Negócio). Chamado
 * quando um envio falha por esse motivo específico, pra o painel mostrar um
 * aviso visível em vez do erro ficar só no log do servidor.
 */
export async function markGeoRestricted(tenantId: string, phone: string, reason: string): Promise<void> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const geoRestriction: GeoRestriction = { detectedAt: new Date().toISOString(), country: inferCountryFromPhone(phone), reason };
  await db.from('conversations').update({ geo_restriction: geoRestriction }).eq('id', conv.id);
}

/** Limpa o histórico de mensagens de um número específico, mas mantém o contato/lead (nome, telefone). */
export async function clearConversationHistory(tenantId: string, phone: string): Promise<StoredConversation | undefined> {
  const db = getDb();
  const { data: existing } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (!existing) return undefined;
  await db.from('messages').delete().eq('conversation_id', existing.id);
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', existing.id);
  return getConversation(tenantId, phone);
}

/** Remove o contato inteiro (não só as mensagens) — usado quando o operador exclui a conversa da lista. */
export async function deleteConversation(tenantId: string, phone: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from('conversations').delete().eq('tenant_id', tenantId).eq('phone', phone).select('id');
  if (error) throw error;
  return !!data?.length;
}

/** Remove uma única mensagem — usado quando o operador apaga um item específico do histórico. */
export async function deleteMessage(tenantId: string, phone: string, messageId: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from('messages').delete().eq('tenant_id', tenantId).eq('id', messageId).select('id');
  if (error) throw error;
  return !!data?.length;
}
