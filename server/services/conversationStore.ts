/**
 * Histórico de conversas reais de WhatsApp — alimenta a caixa de mensagens
 * do frontend (WhatsAppLeadsSim) com dados de verdade em vez do mock local.
 * Migrado do Map em memória + JSON no Supabase Storage (Bloco 2.A) pras
 * tabelas Postgres `conversations`/`messages`, particionadas por tenant_id
 * — ver supabase/migrations/0001_multi_tenant_schema.sql.
 */
import { getDb } from './db';
import { listLabels, listLabelsByConversationId } from './conversationLabelStore';
import { emitConversationUpdated } from './conversationEvents';

/**
 * Reação de emoji a uma mensagem — metadado só do nosso painel (a Meta
 * Cloud API não expõe reagir a mensagem já enviada do jeito que o app
 * WhatsApp faz). Upsert por ator: reagir de novo troca a reação anterior do
 * mesmo ator, nunca acumula.
 */
export interface MessageReaction {
  emoji: string;
  by: 'agent' | 'lead';
  at: string;
}

export interface StoredMessage {
  id: string;
  sender: 'lead' | 'agent';
  type: 'text' | 'audio' | 'image' | 'file';
  text?: string;
  timestamp: string;
  /** id de outra mensagem desta conversa que esta responde (quote) — metadado só do painel. */
  replyToMessageId?: string;
  /** id da mensagem original de onde esta foi encaminhada — metadado só do painel. */
  forwardedFromMessageId?: string;
  /** presente quando o texto foi editado depois de enviado — só mensagens do agente/operador podem ser editadas. */
  editedAt?: string;
  reactions?: MessageReaction[];
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
  /** Etiquetas livres (tipo WhatsApp Business) — ver conversationLabelStore.ts. */
  labels?: string[];
  /** Organização da conversa no painel — arquivar, fixar, silenciar, não lida manual (ver updateConversationState). */
  archivedAt?: string;
  pinnedAt?: string;
  muted?: boolean;
  manuallyUnread?: boolean;
  /** Título do anúncio "Clique para WhatsApp" que originou a conversa (ver attachAdReferralIfMissing) — undefined se a conversa não veio de um anúncio. */
  adHeadline?: string;
  /** Lead não qualificado/insistente — IA para de responder automaticamente só pra esse número (ver isConversationAiBlocked). O resto do atendimento automático do tenant continua normal, diferente de agent_status (pausa geral). */
  aiBlockedAt?: string;
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
  archived_at: string | null;
  pinned_at: string | null;
  muted: boolean | null;
  manually_unread: boolean | null;
  ad_headline: string | null;
  ai_blocked_at: string | null;
  messages?: MessageRow[];
};

type MessageRow = {
  id: string;
  sender: 'lead' | 'agent';
  type: StoredMessage['type'];
  text: string | null;
  created_at: string;
  reply_to_message_id: string | null;
  forwarded_from_message_id: string | null;
  edited_at: string | null;
  reactions: MessageReaction[] | null;
};

function toStoredConversation(row: ConversationRow): StoredConversation {
  return {
    phone: row.phone,
    name: row.name || undefined,
    updatedAt: row.updated_at,
    geoRestriction: row.geo_restriction || undefined,
    archivedAt: row.archived_at || undefined,
    pinnedAt: row.pinned_at || undefined,
    muted: !!row.muted,
    manuallyUnread: !!row.manually_unread,
    adHeadline: row.ad_headline || undefined,
    aiBlockedAt: row.ai_blocked_at || undefined,
    messages: (row.messages || [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        type: m.type,
        text: m.text || undefined,
        timestamp: m.created_at,
        replyToMessageId: m.reply_to_message_id || undefined,
        forwardedFromMessageId: m.forwarded_from_message_id || undefined,
        editedAt: m.edited_at || undefined,
        reactions: m.reactions && m.reactions.length ? m.reactions : undefined,
      })),
  };
}

const CONVERSATION_WITH_MESSAGES = '*, messages(id, sender, type, text, created_at, reply_to_message_id, forwarded_from_message_id, edited_at, reactions)';

/** Resolve o telefone da conversa a partir do id (usado por mutações que só têm o id da mensagem, não o telefone) e dispara o evento. */
async function emitUpdatedByConversationId(tenantId: string, conversationId: string): Promise<void> {
  const db = getDb();
  const { data: conv } = await db.from('conversations').select('phone').eq('id', conversationId).maybeSingle();
  if (conv?.phone) emitConversationUpdated(tenantId, conv.phone);
}

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
  if (error) {
    if (error.code === '23505') {
      // race: outra chamada concorrente (ex: attachAdReferralIfMissing vs
      // recordIncomingMessage, ambas pro mesmo tenant_id+phone novo) já
      // criou essa conversa entre o SELECT e o INSERT acima — busca a linha
      // real em vez de propagar o erro de constraint única e perder a
      // mensagem do lead.
      const { data: existingAfterRace } = await db
        .from('conversations')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .maybeSingle();
      if (existingAfterRace) return existingAfterRace;
    }
    throw error;
  }
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
  customId?: string,
  replyToMessageId?: string
): Promise<StoredConversation> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone, name);
  const id = customId || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db
    .from('messages')
    .insert({ id, tenant_id: tenantId, conversation_id: conv.id, sender: 'lead', type: message.type, text: message.text ?? null, reply_to_message_id: replyToMessageId || null });
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
  emitConversationUpdated(tenantId, phone);
  return (await getConversation(tenantId, phone))!;
}

export async function recordOutgoingMessage(
  tenantId: string,
  phone: string,
  message: Omit<StoredMessage, 'id' | 'sender'>,
  replyToMessageId?: string,
  forwardedFromMessageId?: string,
  /** ID pré-gerado pra essa mensagem — usado quando quem chama precisa saber o id ANTES de gravar (ex: pra salvar a mídia real sob o mesmo id em mediaImageStore, ver /send-media em conversations.ts). Sem isso, o id só existia dentro desta função e ninguém conseguia associar o áudio/imagem enviado à mensagem gravada. */
  customId?: string
): Promise<StoredConversation> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const id = customId || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db
    .from('messages')
    .insert({
      id,
      tenant_id: tenantId,
      conversation_id: conv.id,
      sender: 'agent',
      type: message.type,
      text: message.text ?? null,
      reply_to_message_id: replyToMessageId || null,
      forwarded_from_message_id: forwardedFromMessageId || null,
    });
  if (error) {
    // Mesmo bug do recordIncomingMessage (ver comentário lá): engolir o erro
    // aqui faz o chamador (ex: triggerAutoReply em webhooks.ts) achar que a
    // resposta do agente foi salva quando não foi — relança pra que o
    // try/catch de quem chama trate de verdade (ex: registrar escalonamento).
    console.error(`❌ [Conversas] tenant=${tenantId} falha ao gravar mensagem ENVIADA pra ${phone} (id=${id}) — resposta do agente perdida do histórico:`, error.message);
    throw new Error(`Falha ao gravar mensagem enviada: ${error.message}`);
  }
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conv.id);
  emitConversationUpdated(tenantId, phone);
  return (await getConversation(tenantId, phone))!;
}

/**
 * Encaminha uma mensagem existente pra outro contato — sempre dentro do
 * MESMO tenant, nunca cross-tenant: tanto a busca da mensagem original
 * quanto o destino (toPhone) são resolvidos com o tenantId do JWT, nunca
 * com um id vindo do body. Grava como nova mensagem enviada (sender=
 * 'agent'), com forwarded_from_message_id apontando pra original —
 * metadado só do painel, não reflete no WhatsApp real via Meta Cloud API.
 */
export async function forwardMessage(tenantId: string, messageId: string, toPhone: string): Promise<StoredConversation> {
  const db = getDb();
  const { data: original } = await db.from('messages').select('id, type, text').eq('tenant_id', tenantId).eq('id', messageId).maybeSingle();
  if (!original) throw new Error('Mensagem original não encontrada.');
  return recordOutgoingMessage(
    tenantId,
    toPhone,
    { type: original.type, text: original.text ?? undefined, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
    undefined,
    original.id
  );
}

/**
 * Reage a uma mensagem com um emoji — upsert por ator: reagir de novo troca
 * a reação anterior do mesmo ator, nunca acumula infinito. Metadado só do
 * painel (a Meta Cloud API não expõe reagir a mensagem já enviada).
 */
export async function reactToMessage(tenantId: string, messageId: string, emoji: string, by: 'agent' | 'lead'): Promise<MessageReaction[]> {
  const db = getDb();
  const { data: existing } = await db.from('messages').select('id, reactions, conversation_id').eq('tenant_id', tenantId).eq('id', messageId).maybeSingle();
  if (!existing) throw new Error('Mensagem não encontrada.');
  const reactions: MessageReaction[] = ((existing.reactions as MessageReaction[]) || []).filter((r) => r.by !== by);
  reactions.push({ emoji, by, at: new Date().toISOString() });
  await db.from('messages').update({ reactions }).eq('id', existing.id);
  await emitUpdatedByConversationId(tenantId, existing.conversation_id);
  return reactions;
}

export type EditMessageResult = { ok: true } | { ok: false; reason: 'not_found' | 'forbidden' };

/**
 * Edita o texto de uma mensagem já enviada — só permite mensagem do
 * agente/operador (sender='agent'); editar mensagem do lead seria
 * falsificar o que o cliente disse de verdade. Marca edited_at, pro
 * frontend mostrar "(editado)" igual ao WhatsApp real. Metadado só do
 * painel, não reflete no WhatsApp real via Meta Cloud API.
 */
export async function editMessage(tenantId: string, messageId: string, newText: string): Promise<EditMessageResult> {
  const db = getDb();
  const { data: existing } = await db.from('messages').select('id, sender, conversation_id').eq('tenant_id', tenantId).eq('id', messageId).maybeSingle();
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.sender !== 'agent') return { ok: false, reason: 'forbidden' };
  await db.from('messages').update({ text: newText, edited_at: new Date().toISOString() }).eq('id', existing.id);
  await emitUpdatedByConversationId(tenantId, existing.conversation_id);
  return { ok: true };
}

/** Atualiza o texto de uma mensagem já registrada (ex: placeholder de áudio → transcrição real). */
export async function updateMessageText(tenantId: string, phone: string, id: string, newText: string): Promise<void> {
  const db = getDb();
  await db.from('messages').update({ text: newText }).eq('tenant_id', tenantId).eq('id', id);
  const { data: existing } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (existing) await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', existing.id);
  emitConversationUpdated(tenantId, phone);
}

/**
 * Ordena conversas fixadas primeiro (mais recentemente fixada primeiro),
 * depois pela última atividade — mesma regra pra ativas e arquivadas.
 */
function sortConversations(a: StoredConversation, b: StoredConversation): number {
  if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
  if (a.pinnedAt) return -1;
  if (b.pinnedAt) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Por padrão, exclui conversas arquivadas da lista principal — pra elas
 * aparecerem, passe includeArchived (usado pela seção "Arquivadas" do
 * painel). Testado em conversationStoreOrganization.test.ts.
 */
export async function listConversations(tenantId: string, opts: { includeArchived?: boolean } = {}): Promise<StoredConversation[]> {
  const db = getDb();
  const { data, error } = await db
    .from('conversations')
    .select(CONVERSATION_WITH_MESSAGES)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const rows = data as unknown as ConversationRow[];
  // Uma query só pras etiquetas de todas as conversas do tenant, em vez de
  // N+1 (uma por conversa) — agrupa por conversation_id em memória.
  const labelsByConversationId = await listLabelsByConversationId(tenantId);
  const all = rows.map((row) => ({ ...toStoredConversation(row), labels: labelsByConversationId.get(row.id) || [] }));
  const visible = opts.includeArchived ? all : all.filter((c) => !c.archivedAt);
  return visible.sort(sortConversations);
}

export async function getConversation(tenantId: string, phone: string): Promise<StoredConversation | undefined> {
  const db = getDb();
  const { data } = await db
    .from('conversations')
    .select(CONVERSATION_WITH_MESSAGES)
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();
  if (!data) return undefined;
  const conv = toStoredConversation(data as unknown as ConversationRow);
  conv.labels = await listLabels(tenantId, phone);
  return conv;
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
  emitConversationUpdated(tenantId, phone);
}

export interface ConversationStatePatch {
  archived?: boolean;
  pinned?: boolean;
  muted?: boolean;
  unread?: boolean;
  /** Identifica o lead — troca/adiciona o nome de exibição do contato (a Meta só manda o nome do perfil de WhatsApp quando o cliente define um; muitos leads chegam só com o número). Sempre uma ação explícita do operador, nunca sobrescrita automaticamente. */
  name?: string;
  /** Lead não qualificado/insistente ("assediando") — true pausa a IA só pra esse número (agentStatus.ts continua controlando o resto do tenant normalmente). O operador pode responder manualmente à vontade; só a resposta automática para. */
  aiBlocked?: boolean;
}

/**
 * Atualiza os estados de organização da conversa (arquivar, fixar, silenciar,
 * marcar como não lida, nome de exibição) — sempre uma ação explícita do
 * operador no painel (menu ⋮ da lista), nunca automática. archived_at/pinned_at
 * guardam quando cada estado foi ativado (null quando desativado), pra dar
 * pra ordenar por "há quanto tempo foi fixado" sem precisar de outra coluna.
 */
export async function updateConversationState(tenantId: string, phone: string, patch: ConversationStatePatch): Promise<StoredConversation | undefined> {
  const db = getDb();
  const { data: existing } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (!existing) return undefined;

  const update: Record<string, any> = {};
  if (patch.archived !== undefined) update.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.pinned !== undefined) update.pinned_at = patch.pinned ? new Date().toISOString() : null;
  if (patch.muted !== undefined) update.muted = patch.muted;
  if (patch.unread !== undefined) update.manually_unread = patch.unread;
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.aiBlocked !== undefined) update.ai_blocked_at = patch.aiBlocked ? new Date().toISOString() : null;

  if (Object.keys(update).length > 0) {
    await db.from('conversations').update(update).eq('id', existing.id);
  }
  emitConversationUpdated(tenantId, phone);
  return getConversation(tenantId, phone);
}

/** Limpa o histórico de mensagens de um número específico, mas mantém o contato/lead (nome, telefone). */
export async function clearConversationHistory(tenantId: string, phone: string): Promise<StoredConversation | undefined> {
  const db = getDb();
  const { data: existing } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (!existing) return undefined;
  await db.from('messages').delete().eq('conversation_id', existing.id);
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', existing.id);
  emitConversationUpdated(tenantId, phone);
  return getConversation(tenantId, phone);
}

/** Remove o contato inteiro (não só as mensagens) — usado quando o operador exclui a conversa da lista. */
export async function deleteConversation(tenantId: string, phone: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from('conversations').delete().eq('tenant_id', tenantId).eq('phone', phone).select('id');
  if (error) throw error;
  const deleted = !!data?.length;
  if (deleted) emitConversationUpdated(tenantId, phone);
  return deleted;
}

/** Remove uma única mensagem — usado quando o operador apaga um item específico do histórico. */
export async function deleteMessage(tenantId: string, phone: string, messageId: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from('messages').delete().eq('tenant_id', tenantId).eq('id', messageId).select('id');
  if (error) throw error;
  const deleted = !!data?.length;
  if (deleted) emitConversationUpdated(tenantId, phone);
  return deleted;
}
