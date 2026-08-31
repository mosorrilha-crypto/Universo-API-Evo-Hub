/**
 * Disparo em massa (broadcast/marketing) via WhatsApp — TASK-0171. CRUD dos
 * números de disparo, templates (metadados), listas de contatos e
 * campanhas, além da lógica de deduplicação (contato já conhecido do
 * tenant / já campanhado recentemente) usada tanto pelo preview do
 * assistente guiado quanto pela criação real da campanha. Ver
 * `supabase/migrations/0068_broadcast_marketing.sql` pro schema completo e
 * o plano da feature pro raciocínio de design.
 */
import { getDb, getPlatformDb } from './db';
import { parseContactsCsv } from './csvParse';
import { uploadWhatsAppMedia } from './metaSend';
import { isValidTimeOfDay, isValidTimezone } from './sendWindow';

function stripDataUriPrefix(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, '');
}

// ─── Números ────────────────────────────────────────────────────────────

export type BroadcastNumberStatus = 'active' | 'paused' | 'banned' | 'warming';
export type BroadcastQualityRating = 'unknown' | 'high' | 'medium' | 'low';

export interface BroadcastNumber {
  id: string;
  tenantId: string;
  label: string;
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string | null;
  status: BroadcastNumberStatus;
  warmupProgressDays: number;
  warmupLastAdvancedOn: string | null;
  qualityRating: BroadcastQualityRating;
  perMinuteCap: number;
  dailyCap: number;
  minGapSeconds: number;
  createdAt: string;
  updatedAt: string;
}

function mapNumberRow(row: any): BroadcastNumber {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id ?? null,
    accessToken: row.access_token ?? null,
    status: row.status,
    warmupProgressDays: row.warmup_progress_days ?? 0,
    warmupLastAdvancedOn: row.warmup_last_advanced_on ?? null,
    qualityRating: row.quality_rating ?? 'unknown',
    perMinuteCap: row.per_minute_cap,
    dailyCap: row.daily_cap,
    minGapSeconds: row.min_gap_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBroadcastNumbers(tenantId: string): Promise<BroadcastNumber[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_numbers').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data || []).map(mapNumberRow);
}

export async function getBroadcastNumber(tenantId: string, id: string): Promise<BroadcastNumber | null> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_numbers').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapNumberRow(data) : null;
}

export interface CreateBroadcastNumberInput {
  label: string;
  phoneNumberId: string;
  wabaId?: string | null;
  accessToken?: string | null;
  perMinuteCap?: number;
  dailyCap?: number;
  minGapSeconds?: number;
}

export async function createBroadcastNumber(tenantId: string, input: CreateBroadcastNumberInput): Promise<BroadcastNumber> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_numbers')
    .insert({
      tenant_id: tenantId,
      label: input.label,
      phone_number_id: input.phoneNumberId,
      waba_id: input.wabaId || null,
      access_token: input.accessToken || null,
      status: 'warming',
      warmup_progress_days: 0,
      warmup_last_advanced_on: null,
      quality_rating: 'unknown',
      per_minute_cap: input.perMinuteCap ?? 5,
      daily_cap: input.dailyCap ?? 1000,
      min_gap_seconds: input.minGapSeconds ?? 8,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapNumberRow(data);
}

export interface UpdateBroadcastNumberPatch {
  label?: string;
  wabaId?: string | null;
  accessToken?: string | null;
  status?: BroadcastNumberStatus;
  qualityRating?: BroadcastQualityRating;
  perMinuteCap?: number;
  dailyCap?: number;
  minGapSeconds?: number;
}

export async function updateBroadcastNumber(tenantId: string, id: string, patch: UpdateBroadcastNumberPatch): Promise<BroadcastNumber | null> {
  const db = getDb();
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.wabaId !== undefined) update.waba_id = patch.wabaId;
  if (patch.accessToken !== undefined && patch.accessToken !== '') update.access_token = patch.accessToken;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.qualityRating !== undefined) update.quality_rating = patch.qualityRating;
  if (patch.perMinuteCap !== undefined) update.per_minute_cap = patch.perMinuteCap;
  if (patch.dailyCap !== undefined) update.daily_cap = patch.dailyCap;
  if (patch.minGapSeconds !== undefined) update.min_gap_seconds = patch.minGapSeconds;
  const { data, error } = await db.from('broadcast_numbers').update(update).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? mapNumberRow(data) : null;
}

/** Usado só pelo job (warmup adaptativo) — nunca exposto direto numa rota de escrita do painel. */
export async function updateBroadcastNumberWarmupProgress(
  tenantId: string,
  id: string,
  patch: { warmupProgressDays?: number; warmupLastAdvancedOn?: string; status?: BroadcastNumberStatus }
): Promise<void> {
  const db = getDb();
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.warmupProgressDays !== undefined) update.warmup_progress_days = patch.warmupProgressDays;
  if (patch.warmupLastAdvancedOn !== undefined) update.warmup_last_advanced_on = patch.warmupLastAdvancedOn;
  if (patch.status !== undefined) update.status = patch.status;
  const { error } = await db.from('broadcast_numbers').update(update).eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}

export async function deleteBroadcastNumber(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('broadcast_numbers').delete().eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}

/** Quantas mensagens esse número já mandou desde `sinceIso` (janela rolante — usado pro cálculo de cota de 60s/24h no job). */
export async function countRecipientsSentSince(broadcastNumberId: string, sinceIso: string): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_campaign_recipients')
    .select('id')
    .eq('broadcast_number_id', broadcastNumberId)
    .in('status', ['sent', 'delivered'])
    .gte('sent_at', sinceIso);
  if (error) throw error;
  return (data || []).length;
}

// ─── Templates ──────────────────────────────────────────────────────────

export type BroadcastTemplateCategory = 'marketing' | 'utility';
export type BroadcastTemplateHeaderType = 'none' | 'image';

export interface BroadcastTemplate {
  id: string;
  tenantId: string;
  name: string;
  language: string;
  category: BroadcastTemplateCategory;
  headerType: BroadcastTemplateHeaderType;
  bodyVariableLabels: string[];
  /** Só pra exibição no Atendimento (placeholders {{label}}) — nunca enviado à Meta, que usa o template já aprovado no Business Manager. */
  bodyText: string;
  /** Data URI base64 — reenviada (upload fresco) toda vez que uma campanha usando este template entra em execução, ver campaign header_media_id. */
  headerImageBase64: string | null;
  footerText: string | null;
  createdAt: string;
}

function mapTemplateRow(row: any): BroadcastTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    language: row.language,
    category: row.category,
    headerType: row.header_type,
    bodyVariableLabels: row.body_variable_labels || [],
    bodyText: row.body_text || '',
    headerImageBase64: row.header_image_base64 ?? null,
    footerText: row.footer_text ?? null,
    createdAt: row.created_at,
  };
}

/** Substitui {{label}} no texto de exibição pelas variables reais do contato — só pra exibição no Atendimento, nunca enviado à Meta. */
export function renderTemplateDisplayText(bodyText: string, variables: Record<string, string>): string {
  return bodyText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, label) => variables[label] ?? '');
}

export async function listBroadcastTemplates(tenantId: string): Promise<BroadcastTemplate[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_templates').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data || []).map(mapTemplateRow);
}

export async function getBroadcastTemplate(tenantId: string, id: string): Promise<BroadcastTemplate | null> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_templates').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapTemplateRow(data) : null;
}

export interface CreateBroadcastTemplateInput {
  name: string;
  language: string;
  category: BroadcastTemplateCategory;
  headerType: BroadcastTemplateHeaderType;
  bodyVariableLabels: string[];
  bodyText?: string;
  headerImageBase64?: string | null;
  footerText?: string | null;
}

export async function createBroadcastTemplate(tenantId: string, input: CreateBroadcastTemplateInput): Promise<BroadcastTemplate> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_templates')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      language: input.language,
      category: input.category,
      header_type: input.headerType,
      body_variable_labels: input.bodyVariableLabels,
      body_text: input.bodyText || '',
      header_image_base64: input.headerImageBase64 || null,
      footer_text: input.footerText || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapTemplateRow(data);
}

export async function updateBroadcastTemplate(
  tenantId: string,
  id: string,
  patch: Partial<CreateBroadcastTemplateInput>
): Promise<BroadcastTemplate | null> {
  const db = getDb();
  const update: Record<string, any> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.language !== undefined) update.language = patch.language;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.headerType !== undefined) update.header_type = patch.headerType;
  if (patch.bodyVariableLabels !== undefined) update.body_variable_labels = patch.bodyVariableLabels;
  if (patch.bodyText !== undefined) update.body_text = patch.bodyText;
  if (patch.headerImageBase64 !== undefined) update.header_image_base64 = patch.headerImageBase64;
  if (patch.footerText !== undefined) update.footer_text = patch.footerText;
  const { data, error } = await db.from('broadcast_templates').update(update).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? mapTemplateRow(data) : null;
}

export async function deleteBroadcastTemplate(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('broadcast_templates').delete().eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}

// ─── Listas de contatos ─────────────────────────────────────────────────

export interface BroadcastContactList {
  id: string;
  tenantId: string;
  name: string;
  sourceFilename: string | null;
  contactCount: number;
  createdBy: string | null;
  createdAt: string;
}

export interface BroadcastContact {
  id: string;
  tenantId: string;
  listId: string;
  phone: string;
  name: string | null;
  variables: Record<string, string>;
  createdAt: string;
}

function mapContactListRow(row: any): BroadcastContactList {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sourceFilename: row.source_filename ?? null,
    contactCount: row.contact_count ?? 0,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

function mapContactRow(row: any): BroadcastContact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    listId: row.list_id,
    phone: row.phone,
    name: row.name ?? null,
    variables: row.variables || {},
    createdAt: row.created_at,
  };
}

export interface ImportContactListResult {
  list: BroadcastContactList;
  imported: number;
  duplicatesIgnored: number;
}

/** Faz o parse do CSV (com dedupe interno já embutido) e cria a lista + contatos. Lança se o CSV não tiver nenhum contato válido. */
export async function importContactList(
  tenantId: string,
  name: string,
  sourceFilename: string | null,
  csvText: string,
  createdBy: string | null
): Promise<ImportContactListResult> {
  const { contacts, duplicatesIgnored } = parseContactsCsv(csvText);
  if (!contacts.length) {
    throw new Error('Nenhum contato válido encontrado no CSV.');
  }

  const db = getDb();
  const { data: listRow, error: listError } = await db
    .from('broadcast_contact_lists')
    .insert({ tenant_id: tenantId, name, source_filename: sourceFilename || null, contact_count: contacts.length, created_by: createdBy })
    .select('*')
    .single();
  if (listError) throw listError;

  const contactRows = contacts.map((c) => ({
    tenant_id: tenantId,
    list_id: listRow.id,
    phone: c.phone,
    name: c.name,
    variables: c.variables,
  }));
  const { error: contactsError } = await db.from('broadcast_contacts').insert(contactRows);
  if (contactsError) throw contactsError;

  return { list: mapContactListRow(listRow), imported: contacts.length, duplicatesIgnored };
}

export async function listContactLists(tenantId: string): Promise<BroadcastContactList[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_contact_lists').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data || []).map(mapContactListRow);
}

export async function getContactList(tenantId: string, listId: string): Promise<BroadcastContactList | null> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_contact_lists').select('*').eq('tenant_id', tenantId).eq('id', listId).maybeSingle();
  if (error) throw error;
  return data ? mapContactListRow(data) : null;
}

/** Todos os contatos de uma lista, sem paginação — usado internamente pela alocação de campanha e pelo preview de deduplicação. */
async function listAllContactsForList(tenantId: string, listId: string): Promise<BroadcastContact[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_contacts').select('*').eq('tenant_id', tenantId).eq('list_id', listId);
  if (error) throw error;
  return (data || []).map(mapContactRow);
}

/** Paginado, pra exibição no painel (drill-down de uma lista importada). */
export async function getContactListContacts(
  tenantId: string,
  listId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ contacts: BroadcastContact[]; total: number }> {
  const all = await listAllContactsForList(tenantId, listId);
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return { contacts: all.slice(offset, offset + limit), total: all.length };
}

/** Busca em lote — usado pelo job pra montar as variables/nome de cada destinatário dequeueado num tick, sem 1 query por contato. */
export async function getBroadcastContactsByIds(tenantId: string, ids: string[]): Promise<Map<string, BroadcastContact>> {
  if (!ids.length) return new Map();
  const db = getDb();
  const { data, error } = await db.from('broadcast_contacts').select('*').eq('tenant_id', tenantId).in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((row: any) => [row.id, mapContactRow(row)]));
}

export async function deleteContactList(tenantId: string, listId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('broadcast_contact_lists').delete().eq('tenant_id', tenantId).eq('id', listId);
  if (error) throw error;
}

// ─── Deduplicação (preview e criação de campanha) ──────────────────────

/** Telefones desse tenant que já têm uma `conversations` — contato já conhecido, não deve ser blastado por padrão. */
async function fetchExistingConversationPhones(tenantId: string, phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const db = getDb();
  const { data, error } = await db.from('conversations').select('phone').eq('tenant_id', tenantId).in('phone', phones);
  if (error) throw error;
  return new Set((data || []).map((row: any) => row.phone));
}

/** Telefones que já receberam alguma campanha `sent`/`delivered` desse tenant dentro da janela de dedupe. */
async function fetchRecentlyCampaignedPhones(tenantId: string, phones: string[], dedupeWindowDays: number): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const db = getDb();
  const cutoffIso = new Date(Date.now() - dedupeWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('broadcast_campaign_recipients')
    .select('phone')
    .eq('tenant_id', tenantId)
    .in('phone', phones)
    .in('status', ['sent', 'delivered'])
    .gte('sent_at', cutoffIso);
  if (error) throw error;
  return new Set((data || []).map((row: any) => row.phone));
}

export interface CampaignAllocationPreview {
  totalContacts: number;
  toSend: number;
  skippedExistingContact: number;
  skippedRecentDuplicate: number;
}

/** Alimenta o Passo 3 do assistente guiado — mostra as contagens antes de qualquer coisa ser criada de verdade. */
export async function previewCampaignAllocation(
  tenantId: string,
  contactListId: string,
  dedupeWindowDays: number
): Promise<CampaignAllocationPreview> {
  const contacts = await listAllContactsForList(tenantId, contactListId);
  const phones = contacts.map((c) => c.phone);
  const [existingPhones, recentPhones] = await Promise.all([
    fetchExistingConversationPhones(tenantId, phones),
    fetchRecentlyCampaignedPhones(tenantId, phones, dedupeWindowDays),
  ]);

  let skippedExistingContact = 0;
  let skippedRecentDuplicate = 0;
  for (const contact of contacts) {
    if (existingPhones.has(contact.phone)) {
      skippedExistingContact++;
      continue;
    }
    if (recentPhones.has(contact.phone)) skippedRecentDuplicate++;
  }

  return {
    totalContacts: contacts.length,
    toSend: contacts.length - skippedExistingContact - skippedRecentDuplicate,
    skippedExistingContact,
    skippedRecentDuplicate,
  };
}

// ─── Campanhas ──────────────────────────────────────────────────────────

export type BroadcastCampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'canceled';

export interface BroadcastCampaign {
  id: string;
  tenantId: string;
  name: string;
  templateId: string;
  contactListId: string;
  headerMediaId: string | null;
  status: BroadcastCampaignStatus;
  dedupeWindowDays: number;
  consentConfirmed: boolean;
  scheduledAt: string | null;
  sendWindowStart: string | null;
  sendWindowEnd: string | null;
  sendWindowTimezone: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapCampaignRow(row: any): BroadcastCampaign {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    templateId: row.template_id,
    contactListId: row.contact_list_id,
    headerMediaId: row.header_media_id ?? null,
    status: row.status,
    dedupeWindowDays: row.dedupe_window_days,
    consentConfirmed: row.consent_confirmed,
    scheduledAt: row.scheduled_at ?? null,
    sendWindowStart: row.send_window_start ?? null,
    sendWindowEnd: row.send_window_end ?? null,
    sendWindowTimezone: row.send_window_timezone || 'America/Sao_Paulo',
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type BroadcastRecipientStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'skipped_existing_contact'
  | 'skipped_recent_duplicate';

export interface BroadcastCampaignRecipient {
  id: string;
  campaignId: string;
  tenantId: string;
  contactId: string;
  broadcastNumberId: string | null;
  conversationId: string | null;
  phone: string;
  status: BroadcastRecipientStatus;
  wamid: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  updatedAt: string;
}

function mapRecipientRow(row: any): BroadcastCampaignRecipient {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    broadcastNumberId: row.broadcast_number_id ?? null,
    conversationId: row.conversation_id ?? null,
    phone: row.phone,
    status: row.status,
    wamid: row.wamid ?? null,
    errorMessage: row.error_message ?? null,
    sentAt: row.sent_at ?? null,
    updatedAt: row.updated_at,
  };
}

export interface NumberAllocationInput {
  broadcastNumberId: string;
  count: number;
}

export interface CreateCampaignInput {
  name: string;
  templateId: string;
  contactListId: string;
  dedupeWindowDays: number;
  consentConfirmed: boolean;
  numberAllocations: NumberAllocationInput[];
  includeExistingContacts?: boolean;
  includeRecentDuplicates?: boolean;
  createdBy: string | null;
}

/**
 * Cria a campanha, os vínculos com os números escolhidos, e já popula todos
 * os `broadcast_campaign_recipients` (inclusive as linhas `skipped_*`, pra
 * auditoria completa de todo contato do CSV) — roda a mesma lógica de
 * `previewCampaignAllocation` pra decidir o status inicial de cada um,
 * respeitando os toggles "incluir mesmo assim".
 */
export async function createCampaign(tenantId: string, input: CreateCampaignInput): Promise<BroadcastCampaign> {
  if (!input.consentConfirmed) {
    throw new Error('Confirme que esta lista tem consentimento pra receber comunicação antes de criar a campanha.');
  }
  if (!input.numberAllocations.length) {
    throw new Error('Selecione ao menos um número de disparo.');
  }

  const contacts = await listAllContactsForList(tenantId, input.contactListId);
  if (!contacts.length) {
    throw new Error('Lista de contatos vazia — importe uma lista com contatos antes de criar a campanha.');
  }

  const phones = contacts.map((c) => c.phone);
  const [existingPhones, recentPhones] = await Promise.all([
    fetchExistingConversationPhones(tenantId, phones),
    fetchRecentlyCampaignedPhones(tenantId, phones, input.dedupeWindowDays),
  ]);

  const db = getDb();
  const { data: campaignRow, error: campaignError } = await db
    .from('broadcast_campaigns')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      template_id: input.templateId,
      contact_list_id: input.contactListId,
      status: 'draft',
      dedupe_window_days: input.dedupeWindowDays,
      consent_confirmed: input.consentConfirmed,
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (campaignError) throw campaignError;
  const campaignId = campaignRow.id;

  for (const alloc of input.numberAllocations) {
    const { error } = await db.from('broadcast_campaign_numbers').insert({
      campaign_id: campaignId,
      broadcast_number_id: alloc.broadcastNumberId,
      allocation_count: alloc.count,
    });
    if (error) throw error;
  }

  const recipientRows: Record<string, any>[] = [];
  const toSendContacts: BroadcastContact[] = [];
  for (const contact of contacts) {
    if (existingPhones.has(contact.phone) && !input.includeExistingContacts) {
      recipientRows.push({
        tenant_id: tenantId,
        campaign_id: campaignId,
        contact_id: contact.id,
        phone: contact.phone,
        status: 'skipped_existing_contact',
      });
      continue;
    }
    if (recentPhones.has(contact.phone) && !input.includeRecentDuplicates) {
      recipientRows.push({
        tenant_id: tenantId,
        campaign_id: campaignId,
        contact_id: contact.id,
        phone: contact.phone,
        status: 'skipped_recent_duplicate',
      });
      continue;
    }
    toSendContacts.push(contact);
  }

  // Divide os contatos que vão receber em blocos sequenciais do tamanho de
  // cada allocation_count, na ordem em que os números foram escolhidos —
  // simples e previsível, não round-robin (ver plano da feature).
  let cursor = 0;
  for (const alloc of input.numberAllocations) {
    const block = toSendContacts.slice(cursor, cursor + alloc.count);
    cursor += alloc.count;
    for (const contact of block) {
      recipientRows.push({
        tenant_id: tenantId,
        campaign_id: campaignId,
        contact_id: contact.id,
        broadcast_number_id: alloc.broadcastNumberId,
        phone: contact.phone,
        status: 'pending',
      });
    }
  }
  // Sobra além da soma das alocações (UI já mostra o total antes de
  // confirmar, mas nunca deixa um contato sem destino silenciosamente) —
  // vai pro último número escolhido.
  if (cursor < toSendContacts.length) {
    const lastAlloc = input.numberAllocations[input.numberAllocations.length - 1];
    for (const contact of toSendContacts.slice(cursor)) {
      recipientRows.push({
        tenant_id: tenantId,
        campaign_id: campaignId,
        contact_id: contact.id,
        broadcast_number_id: lastAlloc.broadcastNumberId,
        phone: contact.phone,
        status: 'pending',
      });
    }
  }

  if (recipientRows.length) {
    const { error: recipientsError } = await db.from('broadcast_campaign_recipients').insert(recipientRows);
    if (recipientsError) throw recipientsError;
  }

  return mapCampaignRow(campaignRow);
}

export async function listCampaigns(tenantId: string): Promise<BroadcastCampaign[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_campaigns').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data || []).map(mapCampaignRow);
}

export async function getCampaign(tenantId: string, campaignId: string): Promise<BroadcastCampaign | null> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_campaigns').select('*').eq('tenant_id', tenantId).eq('id', campaignId).maybeSingle();
  if (error) throw error;
  return data ? mapCampaignRow(data) : null;
}

export interface CampaignNumberAllocation {
  broadcastNumberId: string;
  allocationCount: number;
}

export async function listCampaignNumberAllocations(tenantId: string, campaignId: string): Promise<CampaignNumberAllocation[]> {
  const db = getDb();
  const { data, error } = await db.from('broadcast_campaign_numbers').select('*').eq('campaign_id', campaignId);
  if (error) throw error;
  return (data || []).map((row: any) => ({ broadcastNumberId: row.broadcast_number_id, allocationCount: row.allocation_count }));
}

export interface CampaignNumberWithDetails extends CampaignNumberAllocation {
  number: BroadcastNumber;
}

/** Usado pelo job — junta broadcast_campaign_numbers com o número de verdade (status/cota/aquecimento). */
export async function listCampaignNumbersWithDetails(tenantId: string, campaignId: string): Promise<CampaignNumberWithDetails[]> {
  const allocations = await listCampaignNumberAllocations(tenantId, campaignId);
  if (!allocations.length) return [];
  const numberIds = allocations.map((a) => a.broadcastNumberId);
  const db = getDb();
  const { data, error } = await db.from('broadcast_numbers').select('*').in('id', numberIds);
  if (error) throw error;
  const byId = new Map((data || []).map((row: any) => [row.id, mapNumberRow(row)]));
  return allocations
    .map((alloc) => ({ ...alloc, number: byId.get(alloc.broadcastNumberId)! }))
    .filter((entry) => entry.number);
}

export interface CampaignRecipientCounts {
  pending: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  skippedExistingContact: number;
  skippedRecentDuplicate: number;
}

function emptyCounts(): CampaignRecipientCounts {
  return { pending: 0, sending: 0, sent: 0, delivered: 0, failed: 0, skippedExistingContact: 0, skippedRecentDuplicate: 0 };
}

const STATUS_TO_COUNT_KEY: Record<BroadcastRecipientStatus, keyof CampaignRecipientCounts> = {
  pending: 'pending',
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  failed: 'failed',
  skipped_existing_contact: 'skippedExistingContact',
  skipped_recent_duplicate: 'skippedRecentDuplicate',
};

/** Contadores por status — total da campanha e quebrado por número (pra aba/filtro por número no painel quando a campanha usa mais de um). */
export async function getCampaignCounts(
  tenantId: string,
  campaignId: string
): Promise<{ total: CampaignRecipientCounts; byNumber: Record<string, CampaignRecipientCounts> }> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_campaign_recipients')
    .select('status, broadcast_number_id')
    .eq('tenant_id', tenantId)
    .eq('campaign_id', campaignId);
  if (error) throw error;

  const total = emptyCounts();
  const byNumber: Record<string, CampaignRecipientCounts> = {};
  for (const row of (data || []) as { status: BroadcastRecipientStatus; broadcast_number_id: string | null }[]) {
    const key = STATUS_TO_COUNT_KEY[row.status];
    total[key]++;
    if (row.broadcast_number_id) {
      if (!byNumber[row.broadcast_number_id]) byNumber[row.broadcast_number_id] = emptyCounts();
      byNumber[row.broadcast_number_id][key]++;
    }
  }
  return { total, byNumber };
}

export interface ListRecipientsFilter {
  status?: BroadcastRecipientStatus;
  broadcastNumberId?: string;
  sentFrom?: string;
  sentTo?: string;
  limit?: number;
  offset?: number;
}

export async function listCampaignRecipients(
  tenantId: string,
  campaignId: string,
  filter: ListRecipientsFilter = {}
): Promise<{ recipients: BroadcastCampaignRecipient[]; total: number }> {
  const db = getDb();
  let query = db.from('broadcast_campaign_recipients').select('*').eq('tenant_id', tenantId).eq('campaign_id', campaignId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.broadcastNumberId) query = query.eq('broadcast_number_id', filter.broadcastNumberId);
  if (filter.sentFrom) query = query.gte('sent_at', filter.sentFrom);
  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []) as any[];
  if (filter.sentTo) rows = rows.filter((row) => !row.sent_at || row.sent_at <= filter.sentTo!);

  const total = rows.length;
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 50;
  return { recipients: rows.slice(offset, offset + limit).map(mapRecipientRow), total };
}

const CAMPAIGN_STATUS_TRANSITIONS: Record<BroadcastCampaignStatus, BroadcastCampaignStatus[]> = {
  // "scheduled -> draft" existe pra dar um jeito de desagendar sem cancelar
  // a campanha inteira (ver rota PATCH — o painel chama isso de "voltar pra
  // rascunho").
  draft: ['scheduled', 'running', 'canceled'],
  scheduled: ['running', 'canceled', 'draft'],
  running: ['paused', 'completed', 'canceled'],
  paused: ['running', 'canceled'],
  completed: [],
  canceled: [],
};

export async function updateCampaignStatus(tenantId: string, campaignId: string, newStatus: BroadcastCampaignStatus): Promise<BroadcastCampaign> {
  const current = await getCampaign(tenantId, campaignId);
  if (!current) throw new Error('Campanha não encontrada.');
  const allowed = CAMPAIGN_STATUS_TRANSITIONS[current.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Transição de status inválida: "${current.status}" → "${newStatus}".`);
  }
  if (newStatus === 'running' && !current.consentConfirmed) {
    throw new Error('Consentimento da lista não confirmado — não é possível iniciar a campanha.');
  }
  if (newStatus === 'scheduled' && !current.scheduledAt) {
    throw new Error('Defina a data/hora de início ("scheduledAt") antes de agendar a campanha.');
  }

  const db = getDb();
  const patch: Record<string, any> = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === 'running' && !current.startedAt) patch.started_at = new Date().toISOString();
  if (newStatus === 'completed') patch.completed_at = new Date().toISOString();
  const { data, error } = await db.from('broadcast_campaigns').update(patch).eq('tenant_id', tenantId).eq('id', campaignId).select('*').single();
  if (error) throw error;
  return mapCampaignRow(data);
}

export interface UpdateCampaignScheduleInput {
  scheduledAt?: string | null;
  sendWindowStart?: string | null;
  sendWindowEnd?: string | null;
  sendWindowTimezone?: string;
}

/**
 * Só ajusta os campos de agendamento/janela de horário, sem mexer no status
 * — usado tanto pra preparar uma campanha `draft` antes de agendar quanto
 * pra ajustar a janela de uma campanha já `running`/`paused` (a janela é
 * respeitada a cada tick do job, não só na hora de agendar).
 */
export async function updateCampaignSchedule(
  tenantId: string,
  campaignId: string,
  input: UpdateCampaignScheduleInput
): Promise<BroadcastCampaign> {
  const current = await getCampaign(tenantId, campaignId);
  if (!current) throw new Error('Campanha não encontrada.');

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (input.scheduledAt !== undefined) {
    if (input.scheduledAt !== null && Number.isNaN(Date.parse(input.scheduledAt))) {
      throw new Error('Campo "scheduledAt" precisa ser uma data/hora válida.');
    }
    patch.scheduled_at = input.scheduledAt;
  }

  const nextStart = input.sendWindowStart !== undefined ? input.sendWindowStart : current.sendWindowStart;
  const nextEnd = input.sendWindowEnd !== undefined ? input.sendWindowEnd : current.sendWindowEnd;
  if ((nextStart === null) !== (nextEnd === null)) {
    throw new Error('Defina os dois horários da janela de envio (início e fim), ou nenhum dos dois.');
  }
  if (nextStart !== null && !isValidTimeOfDay(nextStart)) {
    throw new Error('Campo "sendWindowStart" precisa estar no formato HH:MM (24h).');
  }
  if (nextEnd !== null && !isValidTimeOfDay(nextEnd)) {
    throw new Error('Campo "sendWindowEnd" precisa estar no formato HH:MM (24h).');
  }
  if (input.sendWindowStart !== undefined) patch.send_window_start = input.sendWindowStart;
  if (input.sendWindowEnd !== undefined) patch.send_window_end = input.sendWindowEnd;
  if (input.sendWindowTimezone !== undefined) {
    if (!isValidTimezone(input.sendWindowTimezone)) {
      throw new Error(`Fuso horário "${input.sendWindowTimezone}" não é reconhecido.`);
    }
    patch.send_window_timezone = input.sendWindowTimezone;
  }

  const db = getDb();
  const { data, error } = await db.from('broadcast_campaigns').update(patch).eq('tenant_id', tenantId).eq('id', campaignId).select('*').single();
  if (error) throw error;
  return mapCampaignRow(data);
}

export async function setCampaignHeaderMediaId(tenantId: string, campaignId: string, mediaId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('broadcast_campaigns')
    .update({ header_media_id: mediaId, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', campaignId);
  if (error) throw error;
}

/**
 * Transição pra `running` de verdade — engloba a validação de status normal
 * e, na 1ª vez que a campanha roda com um template de cabeçalho de imagem,
 * o upload fresco do `header_media_id` (reaproveitado por todo destinatário
 * de qualquer número da campanha). Antes esse upload só acontecia dentro da
 * rota PATCH; extraído pra cá porque o job de envio também precisa fazer a
 * mesma coisa ao promover sozinho uma campanha `scheduled` na hora marcada
 * — sem isso, uma campanha agendada com imagem de cabeçalho começaria a
 * rodar sem nunca ter feito o upload.
 */
export async function transitionCampaignToRunning(tenantId: string, campaignId: string): Promise<BroadcastCampaign> {
  let campaign = await updateCampaignStatus(tenantId, campaignId, 'running');
  if (campaign.headerMediaId) return campaign;

  const template = await getBroadcastTemplate(tenantId, campaign.templateId);
  if (template?.headerType !== 'image') return campaign;
  if (!template.headerImageBase64) {
    throw new Error('Este template usa cabeçalho de imagem, mas nenhuma imagem foi salva nele ainda.');
  }
  const allocations = await listCampaignNumberAllocations(tenantId, campaignId);
  const firstNumber = allocations[0] ? await getBroadcastNumber(tenantId, allocations[0].broadcastNumberId) : null;
  if (!firstNumber) throw new Error('Número de disparo da campanha não encontrado.');

  const mimeMatch = template.headerImageBase64.match(/^data:([^;]+);base64,/);
  const buffer = Buffer.from(stripDataUriPrefix(template.headerImageBase64), 'base64');
  const mediaId = await uploadWhatsAppMedia(firstNumber.phoneNumberId, firstNumber.accessToken || undefined, buffer, mimeMatch?.[1] || 'image/jpeg', 'header.jpg');
  await setCampaignHeaderMediaId(tenantId, campaignId, mediaId);
  campaign = { ...campaign, headerMediaId: mediaId };
  return campaign;
}

// ─── Usado só pelo job de envio (broadcastSenderJob.ts) ────────────────

/** Cross-tenant — só pro job descobrir quais tenants têm campanha rodando, antes de entrar no contexto RLS de cada um. */
export async function listRunningCampaignsAcrossTenants(): Promise<Array<{ tenantId: string; campaignId: string }>> {
  const db = getPlatformDb();
  const { data, error } = await db.from('broadcast_campaigns').select('id, tenant_id').eq('status', 'running');
  if (error) throw error;
  return (data || []).map((row: any) => ({ tenantId: row.tenant_id, campaignId: row.id }));
}

/**
 * Cross-tenant — campanhas `scheduled` cuja hora marcada já chegou, pro job
 * promover sozinho pra `running` (ver `transitionCampaignToRunning`). Sem
 * isso o campo `scheduledAt` era só decorativo (TASK-0173).
 */
export async function listScheduledCampaignsDueToStart(): Promise<Array<{ tenantId: string; campaignId: string }>> {
  const db = getPlatformDb();
  const { data, error } = await db
    .from('broadcast_campaigns')
    .select('id, tenant_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString());
  if (error) throw error;
  return (data || []).map((row: any) => ({ tenantId: row.tenant_id, campaignId: row.id }));
}

export async function dequeuePendingRecipients(campaignId: string, broadcastNumberId: string, limit: number): Promise<BroadcastCampaignRecipient[]> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_campaign_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('broadcast_number_id', broadcastNumberId)
    .eq('status', 'pending')
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapRecipientRow);
}

export async function markRecipientSending(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('broadcast_campaign_recipients').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function markRecipientSent(id: string, wamid: string | undefined, conversationId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from('broadcast_campaign_recipients')
    .update({ status: 'sent', wamid: wamid || null, conversation_id: conversationId, sent_at: now, updated_at: now })
    .eq('id', id);
  if (error) throw error;
}

export async function markRecipientFailed(id: string, errorMessage: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('broadcast_campaign_recipients')
    .update({ status: 'failed', error_message: errorMessage.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Marca a campanha `completed` se não sobrar nenhum destinatário pendente/em envio em nenhum número dela. */
export async function markCampaignCompletedIfDone(tenantId: string, campaignId: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from('broadcast_campaign_recipients')
    .select('id')
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'sending'])
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return;
  await db
    .from('broadcast_campaigns')
    .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', campaignId)
    .eq('status', 'running');
}
