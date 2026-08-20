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
import { registerPendingEcho } from './outboundEchoTracker';
import { isAdsOnlyMode, getAdTriggerMessages, matchesAdTriggerMessage } from './agentStatus';

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
  /** id de outra mensagem desta conversa que esta responde (quote). Quando a mensagem citada tem um id real de provedor (wamid da Meta / id do Baileys, não o `wa-...` gerado localmente), o envio real (metaSend.ts/evolutionSend.ts) também manda esse contexto pra API — o cliente vê "em resposta a" de verdade no WhatsApp dele, não só no nosso painel. */
  replyToMessageId?: string;
  /** id da mensagem original de onde esta foi encaminhada — metadado só do painel. */
  forwardedFromMessageId?: string;
  reactions?: MessageReaction[];
  /** Só presente quando sender='agent' — distingue resposta automática da IA de mensagem digitada manualmente por um operador no painel (ver issue #126). */
  sentBy?: 'ai' | 'operator';
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
  /** Conversa identificada como vinda de anúncio — automaticamente (ctwa_clid real ou texto batendo com um gatilho configurado, ver markAdGreetingMatched) ou manualmente pelo operador (ver updateConversationState, campo adLead). Só importa no modo "Só Anúncios" (agentStatus.isAdsOnlyMode): libera a resposta automática pra essa conversa mesmo sem referral real. */
  adGreetingMatchedAt?: string;
  /** IA para de responder automaticamente só pra esse número — ligado manualmente pelo operador (lead não qualificado/insistente) OU automaticamente pelo próprio autoReply.ts (alucinação de agenda sem ferramenta pra sustentar, ver stopAutoReply em autoReply.ts). O resto do atendimento automático do tenant continua normal, diferente de agent_status (pausa geral). */
  aiBlockedAt?: string;
  /** Quantidade de mensagens do lead recebidas depois da última vez que o operador abriu esta conversa (ver markConversationRead). Não confundir com manuallyUnread (override manual do operador) — o painel trata a conversa como não lida quando qualquer um dos dois é verdadeiro. */
  unreadCount: number;
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
  ad_greeting_matched_at: string | null;
  last_read_at: string;
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
  reactions: MessageReaction[] | null;
  sent_by: 'ai' | 'operator' | null;
};

/** Conta mensagens do lead chegadas depois de lastReadAt — extraída à parte pra ser testável sem depender do formato de embed relacional do Supabase. */
export function countUnreadMessages(messages: Pick<MessageRow, 'sender' | 'created_at'>[], lastReadAt: string): number {
  return messages.filter((m) => m.sender === 'lead' && m.created_at > lastReadAt).length;
}

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
    adGreetingMatchedAt: row.ad_greeting_matched_at || undefined,
    unreadCount: countUnreadMessages(row.messages || [], row.last_read_at),
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
        reactions: m.reactions && m.reactions.length ? m.reactions : undefined,
        sentBy: m.sent_by || undefined,
      })),
  };
}

const CONVERSATION_WITH_MESSAGES = '*, messages(id, sender, type, text, created_at, reply_to_message_id, forwarded_from_message_id, reactions, sent_by)';

/** Resolve o telefone da conversa a partir do id (usado por mutações que só têm o id da mensagem, não o telefone) e dispara o evento. */
async function emitUpdatedByConversationId(tenantId: string, conversationId: string): Promise<void> {
  const db = getDb();
  const { data: conv } = await db.from('conversations').select('phone').eq('id', conversationId).maybeSingle();
  if (conv?.phone) emitConversationUpdated(tenantId, conv.phone);
}

/**
 * Marca a conversa como lida agora — mensagens do lead recebidas antes deste
 * instante deixam de contar em unreadCount. Chamado quando o operador abre a
 * conversa no painel (WhatsAppLeadsSim). Sem-op silencioso se a conversa
 * ainda não existir (nada pra marcar como lido).
 */
export async function markConversationRead(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  await db
    .from('conversations')
    .update({ last_read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('phone', phone);
  emitConversationUpdated(tenantId, phone);
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

/**
 * Grava o nome que a cliente disse na própria conversa (não veio do perfil
 * do WhatsApp) — reaproveita a mesma coluna `name` que já guarda o nome de
 * perfil, então a partir daqui ele vira `contactName` normalmente em todo
 * turno seguinte, sem depender da janela de histórico recente pra "lembrar"
 * dele (achado em pesquisa de mercado: perder o nome do cliente depois de
 * algumas mensagens é um dos sinais mais claros de que é um bot, não uma
 * pessoa). Só grava se ainda não existir nome nenhum pra essa conversa —
 * nunca sobrescreve um nome de perfil real do WhatsApp, que é sempre mais
 * confiável que um nome extraído de texto livre pela IA.
 */
export async function setConversationNameIfMissing(tenantId: string, phone: string, name: string): Promise<void> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const { data: existing } = await db.from('conversations').select('name').eq('id', conv.id).maybeSingle();
  if (existing?.name) return;
  await db.from('conversations').update({ name }).eq('id', conv.id);
  emitConversationUpdated(tenantId, phone);
}

/**
 * Marca essa conversa como vinda de anúncio pelo texto da mensagem bater
 * com um dos gatilhos configurados (ver matchesAdTriggerMessage em
 * agentStatus.ts) — complementa o ctwa_clid pra quando a Meta não manda
 * esse dado no referral. Idempotente: só grava a primeira vez, nunca
 * sobrescreve (mesmo padrão de attachAdReferralIfMissing acima).
 */
export async function markAdGreetingMatched(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  const conv = await getOrCreateConversationRow(tenantId, phone);
  const { data: existing } = await db.from('conversations').select('ad_greeting_matched_at').eq('id', conv.id).maybeSingle();
  if (existing?.ad_greeting_matched_at) return;
  await db.from('conversations').update({ ad_greeting_matched_at: new Date().toISOString() }).eq('id', conv.id);
}

/** true se essa conversa já foi identificada como vinda de anúncio pelo texto da mensagem (ver markAdGreetingMatched). */
export async function getConversationAdGreetingMatched(tenantId: string, phone: string): Promise<boolean> {
  const db = getDb();
  const { data } = await db.from('conversations').select('ad_greeting_matched_at').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  return !!data?.ad_greeting_matched_at;
}

/**
 * true = a resposta automática deve ficar em silêncio agora por causa do
 * modo "somente anúncios" (agentStatus.isAdsOnlyMode). Um lead já
 * identificado como vindo de anúncio (ctwa_clid real OU texto batendo com
 * um gatilho configurado, marcando a conversa via markAdGreetingMatched)
 * sempre passa — o gatilho de texto só precisa bater na primeira mensagem,
 * as seguintes da mesma conversa continuam liberadas. Compartilhado entre
 * o caminho de texto (webhooks.ts) e o de áudio transcrito
 * (transcriptionQueue.ts, passa a transcrição como `text`).
 */
export async function shouldBlockForAdsOnlyMode(tenantId: string, phone: string, text: string): Promise<boolean> {
  if (!(await isAdsOnlyMode(tenantId))) return false;
  if (await getConversationCtwaClid(tenantId, phone)) return false;
  if (await getConversationAdGreetingMatched(tenantId, phone)) return false;
  const triggers = await getAdTriggerMessages(tenantId);
  if (matchesAdTriggerMessage(text, triggers)) {
    await markAdGreetingMatched(tenantId, phone);
    return false;
  }
  return true;
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
  /** Quem gerou esta mensagem de verdade — resposta automática da IA ou digitada manualmente por um operador no painel (ver issue #126). Sempre obrigatório: toda chamada precisa decidir explicitamente qual dos dois é. */
  sentBy: 'ai' | 'operator',
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
      sent_by: sentBy,
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
  // Registra a marca de eco DEPOIS do envio real (webhooks.ts/conversations.ts
  // sempre chamam recordOutgoingMessage só após a chamada de envio ter tido
  // sucesso) — só pra tenant conectado via Evolution API o eco fromMe:true
  // chega de volta; pra Meta essa marca simplesmente nunca é
  // consumida e expira sozinha (sem custo real). Ver outboundEchoTracker.ts.
  registerPendingEcho(tenantId, phone, message.type, message.type === 'text' ? message.text : undefined).catch(() => {});
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
    'operator', // encaminhar é sempre uma ação manual do operador clicando no painel
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

export interface MessageForReply {
  id: string;
  sender: 'lead' | 'agent';
  type: StoredMessage['type'];
  text?: string;
}

/**
 * Busca só os campos necessários pra montar o contexto de "responder a"
 * numa API real (Meta `context.message_id` / Evolution `quoted`) — nunca
 * cross-tenant. Ver server/routes/conversations.ts (POST /send).
 */
export async function getMessageForReply(tenantId: string, messageId: string): Promise<MessageForReply | undefined> {
  const db = getDb();
  const { data } = await db.from('messages').select('id, sender, type, text').eq('tenant_id', tenantId).eq('id', messageId).maybeSingle();
  if (!data) return undefined;
  return { id: data.id, sender: data.sender, type: data.type, text: data.text ?? undefined };
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
  /** true pausa a IA só pra esse número (agentStatus.ts continua controlando o resto do tenant normalmente). O operador pode responder manualmente à vontade; só a resposta automática para. Origem: ação explícita do operador (lead não qualificado/insistente) OU automática, disparada por autoReply.ts (stopAutoReply) quando a IA aluciona um agendamento sem nenhuma ferramenta pra sustentar — evita repetir o mesmo erro mensagem após mensagem até um humano assumir. */
  aiBlocked?: boolean;
  /** Pedido real (20/08/2026): no modo "Só Anúncios", um lead real de anúncio às vezes chega sem ctwa_clid e sem bater em nenhum gatilho de texto configurado — a IA fica calada e o operador precisa assumir manualmente (ex: Olga Ayala, conversa iniciada por "Buenas precio??" sem referral nenhum). Deixa o operador sinalizar manualmente "esse lead é de anúncio, pode liberar a IA" sem precisar configurar um gatilho novo — mesmo efeito de markAdGreetingMatched, só que via ação humana em vez do texto batendo automaticamente. Sempre true (não existe "desmarcar" — mesma semântica idempotente/nunca-sobrescreve do resto do fluxo de ad referral). */
  adLead?: true;
}

/**
 * Atualiza os estados de organização da conversa (arquivar, fixar, silenciar,
 * marcar como não lida, nome de exibição, bloquear IA). A maioria é sempre
 * uma ação explícita do operador no painel (menu ⋮ da lista) — a exceção é
 * aiBlocked, que também pode vir automaticamente de webhooks.ts (ver
 * ConversationStatePatch.aiBlocked acima). archived_at/pinned_at guardam
 * quando cada estado foi ativado (null quando desativado), pra dar pra
 * ordenar por "há quanto tempo foi fixado" sem precisar de outra coluna.
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
  if (patch.adLead) await markAdGreetingMatched(tenantId, phone);

  if (Object.keys(update).length > 0) {
    const { error } = await db.from('conversations').update(update).eq('id', existing.id);
    if (error) throw error;
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
