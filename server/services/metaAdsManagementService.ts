import { getDb } from './db';
import { recordOperationEvent } from './operationEventStore';

const META_GRAPH_VERSION = 'v26.0';
const MAX_CAMPAIGN_NAME_LENGTH = 120;
const MAX_DAILY_BUDGET_MINOR = 5_000_000;

export const META_CLICK_TO_WHATSAPP_OBJECTIVES = [
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_SALES',
  'OUTCOME_TRAFFIC',
] as const;

export type MetaClickToWhatsAppObjective = typeof META_CLICK_TO_WHATSAPP_OBJECTIVES[number];
export type MetaCampaignMutationStatus = 'PAUSED' | 'ACTIVE' | 'ARCHIVED';
export type MetaAdsOperation = 'create_campaign' | 'update_campaign_status' | 'update_campaign_budget';

export interface MetaManagedCampaign {
  id: string;
  name?: string;
  objective?: MetaClickToWhatsAppObjective;
  status?: MetaCampaignMutationStatus;
  dailyBudgetMinor?: number;
}

interface MetaAdsManagementCredentials {
  adAccountId: string;
  accessToken: string;
}

interface MetaAdsOperationRow {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  operation: string;
  resource_id: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  response: Record<string, unknown> | null;
  error_message: string | null;
}

export class MetaAdsManagementConfigurationError extends Error {}
export class MetaAdsManagementValidationError extends Error {}
export class MetaAdsManagementRequestError extends Error {}
export class MetaAdsOperationInProgressError extends Error {}
export class MetaAdsOperationAlreadyFailedError extends Error {}

function normalizedAccountId(value: unknown): string {
  return String(value || '').trim().replace(/^act_/, '');
}

function validAdAccountId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^act_\d+$/.test(normalized)) {
    throw new MetaAdsManagementConfigurationError('A conta de anúncios deve estar no formato act_<id>.');
  }
  return normalized;
}

function validCampaignId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(normalized)) {
    throw new MetaAdsManagementValidationError('O identificador da campanha informado é inválido.');
  }
  return normalized;
}

function validIdempotencyKey(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/.test(normalized)) {
    throw new MetaAdsManagementValidationError('A operação precisa de uma chave de idempotência válida.');
  }
  return normalized;
}

function validCampaignName(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < 2 || normalized.length > MAX_CAMPAIGN_NAME_LENGTH) {
    throw new MetaAdsManagementValidationError(`O nome da campanha deve ter entre 2 e ${MAX_CAMPAIGN_NAME_LENGTH} caracteres.`);
  }
  return normalized;
}

function validObjective(value: unknown): MetaClickToWhatsAppObjective {
  if (typeof value !== 'string' || !META_CLICK_TO_WHATSAPP_OBJECTIVES.includes(value as MetaClickToWhatsAppObjective)) {
    throw new MetaAdsManagementValidationError('Objetivo inválido para uma campanha Click to WhatsApp.');
  }
  return value as MetaClickToWhatsAppObjective;
}

function validSpecialAdCategories(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some((item) => typeof item !== 'string')) {
    throw new MetaAdsManagementValidationError('As categorias especiais precisam ser uma lista curta de códigos Meta.');
  }
  const categories = value.map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (categories.includes('NONE') && categories.length > 1) {
    throw new MetaAdsManagementValidationError('NONE não pode ser combinado com outra categoria especial.');
  }
  return categories.filter((item) => item !== 'NONE');
}

function validMutationStatus(value: unknown): MetaCampaignMutationStatus {
  if (value !== 'PAUSED' && value !== 'ACTIVE' && value !== 'ARCHIVED') {
    throw new MetaAdsManagementValidationError('Status inválido. Use PAUSED, ACTIVE ou ARCHIVED.');
  }
  return value;
}

function validDailyBudgetMinor(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_DAILY_BUDGET_MINOR) {
    throw new MetaAdsManagementValidationError(`O orçamento diário deve ser um inteiro entre 1 e ${MAX_DAILY_BUDGET_MINOR} na menor unidade da moeda.`);
  }
  return parsed;
}

function safeMetaMessage(payload: any, status: number): string {
  const code = Number(payload?.error?.code);
  const message = payload?.error?.error_user_msg || payload?.error?.message;
  if (code === 190) return 'O token de gerenciamento Meta expirou ou foi revogado. Gere outro token com ads_management e salve-o na Central de Anúncios.';
  if (code === 200 || /permission|ads_management|pages_manage_ads|pages_read_engagement|pages_show_list/i.test(String(message || ''))) {
    return 'A Meta recusou a operação por permissão. Use um token com ads_management e, para Click to WhatsApp, as permissões de página documentadas pela Meta.';
  }
  if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
  return `A Meta não concluiu a operação de anúncios (HTTP ${status}).`;
}

async function graphRequest<T>(path: string, method: 'GET' | 'POST' | 'DELETE', params: Record<string, string>, accessToken: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  const request: RequestInit = {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  if (method === 'GET') {
    for (const [key, value] of body.entries()) url.searchParams.set(key, value);
  } else {
    request.body = body;
  }
  let response: Response;
  try {
    response = await fetch(url, request);
  } catch {
    throw new MetaAdsManagementRequestError('Não foi possível conectar à Meta para executar a operação.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new MetaAdsManagementRequestError(safeMetaMessage(payload, response.status));
  return payload as T;
}

async function assertCampaignBelongsToAccount(credentials: MetaAdsManagementCredentials, campaignId: string): Promise<void> {
  const payload = await graphRequest<{ id?: string; account_id?: string }>(campaignId, 'GET', { fields: 'id,account_id' }, credentials.accessToken);
  if (String(payload.id || '') !== campaignId || normalizedAccountId(payload.account_id) !== normalizedAccountId(credentials.adAccountId)) {
    throw new MetaAdsManagementRequestError('A campanha informada não pertence à conta de anúncios configurada para este tenant.');
  }
}

async function getManagementCredentials(tenantId: string): Promise<MetaAdsManagementCredentials> {
  const database = getDb();
  const { data, error } = await database
    .from('tenant_meta_credentials')
    .select('meta_ads_account_id, meta_ads_management_access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível ler a autorização de gerenciamento Meta: ${error.message}`);
  if (!data?.meta_ads_account_id || !data?.meta_ads_management_access_token) {
    throw new MetaAdsManagementConfigurationError('Configure um token separado da Marketing API com ads_management antes de usar as operações de escrita.');
  }
  return {
    adAccountId: validAdAccountId(data.meta_ads_account_id),
    accessToken: data.meta_ads_management_access_token,
  };
}

async function findOperation(tenantId: string, idempotencyKey: string, operation: MetaAdsOperation): Promise<MetaAdsOperationRow | null> {
  const database = getDb();
  const { data, error } = await database
    .from('meta_ads_operation_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', idempotencyKey)
    .eq('operation', operation)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível verificar a idempotência da operação Meta: ${error.message}`);
  return (data as MetaAdsOperationRow | null) || null;
}

async function startOperation(tenantId: string, idempotencyKey: string, operation: MetaAdsOperation, resourceId: string | null): Promise<{ row: MetaAdsOperationRow; reused: boolean }> {
  const existing = await findOperation(tenantId, idempotencyKey, operation);
  if (existing) return { row: existing, reused: true };

  const database = getDb();
  const { data, error } = await database
    .from('meta_ads_operation_requests')
    .insert({ tenant_id: tenantId, idempotency_key: idempotencyKey, operation, resource_id: resourceId, status: 'pending' })
    .select('*')
    .single();
  if (!error && data) return { row: data as MetaAdsOperationRow, reused: false };

  // Outra instância pode ter ganhado a corrida entre find e insert. Relê a linha
  // única e mantém o mesmo resultado, sem repetir a chamada externa.
  const raced = await findOperation(tenantId, idempotencyKey, operation);
  if (raced) return { row: raced, reused: true };
  throw new Error(`Não foi possível iniciar a operação Meta: ${error?.message || 'erro desconhecido'}`);
}

function operationResponse(row: MetaAdsOperationRow): Record<string, unknown> {
  if (row.status === 'pending') throw new MetaAdsOperationInProgressError('Esta operação já está em andamento. Aguarde a atualização antes de tentar novamente.');
  if (row.status === 'failed') throw new MetaAdsOperationAlreadyFailedError(row.error_message || 'A operação anterior falhou. Gere uma nova chave para tentar novamente.');
  return row.response || {};
}

async function finishOperation(
  tenantId: string,
  row: MetaAdsOperationRow,
  operation: MetaAdsOperation,
  response: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const database = getDb();
  const { error } = await database
    .from('meta_ads_operation_requests')
    .update({ status: 'succeeded', response, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`A Meta concluiu a operação, mas o resultado não pôde ser persistido: ${error.message}`);
  void recordOperationEvent({
    tenantId,
    eventType: `meta_ads_${operation}`,
    payload: { operation, resourceId: response.id || row.resource_id, status: response.status || null },
  }).catch(() => undefined);
  return response;
}

async function failOperation(tenantId: string, row: MetaAdsOperationRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Falha desconhecida na operação Meta.';
  const database = getDb();
  await database
    .from('meta_ads_operation_requests')
    .update({ status: 'failed', error_message: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('tenant_id', tenantId);
  void recordOperationEvent({
    tenantId,
    eventType: 'meta_ads_operation_failed',
    payload: { operation: row.operation, resourceId: row.resource_id, errorCode: error instanceof MetaAdsManagementRequestError ? 'META_REQUEST_FAILED' : 'VALIDATION_OR_SYSTEM' },
  }).catch(() => undefined);
}

async function runIdempotentMutation(
  tenantId: string,
  idempotencyKeyInput: string,
  operation: MetaAdsOperation,
  resourceId: string | null,
  request: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const idempotencyKey = validIdempotencyKey(idempotencyKeyInput);
  const { row, reused } = await startOperation(tenantId, idempotencyKey, operation, resourceId);
  if (reused) return operationResponse(row);
  try {
    const response = await request();
    return finishOperation(tenantId, row, operation, response);
  } catch (error) {
    await failOperation(tenantId, row, error);
    throw error;
  }
}

export async function createMetaCampaign(
  tenantId: string,
  input: { name: unknown; objective: unknown; specialAdCategories?: unknown },
  idempotencyKey: string,
): Promise<MetaManagedCampaign> {
  const credentials = await getManagementCredentials(tenantId);
  const name = validCampaignName(input.name);
  const objective = validObjective(input.objective);
  const specialAdCategories = validSpecialAdCategories(input.specialAdCategories);
  const result = await runIdempotentMutation(tenantId, idempotencyKey, 'create_campaign', null, async () => {
    const payload = await graphRequest<{ id?: string }>(`${credentials.adAccountId}/campaigns`, 'POST', {
      name,
      objective,
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(specialAdCategories),
    }, credentials.accessToken);
    if (!payload.id) throw new MetaAdsManagementRequestError('A Meta não devolveu o identificador da campanha criada.');
    return { id: payload.id, name, objective, status: 'PAUSED' };
  });
  return payloadToCampaign(result);
}

export async function updateMetaCampaignStatus(
  tenantId: string,
  campaignId: unknown,
  status: unknown,
  idempotencyKey: string,
): Promise<MetaManagedCampaign> {
  const credentials = await getManagementCredentials(tenantId);
  const id = validCampaignId(campaignId);
  const nextStatus = validMutationStatus(status);
  const result = await runIdempotentMutation(tenantId, idempotencyKey, 'update_campaign_status', id, async () => {
    await assertCampaignBelongsToAccount(credentials, id);
    await graphRequest<Record<string, unknown>>(`${id}`, 'POST', { status: nextStatus }, credentials.accessToken);
    return { id, status: nextStatus };
  });
  return payloadToCampaign(result);
}

export async function updateMetaCampaignBudget(
  tenantId: string,
  campaignId: unknown,
  dailyBudgetMinor: unknown,
  idempotencyKey: string,
): Promise<MetaManagedCampaign> {
  const credentials = await getManagementCredentials(tenantId);
  const id = validCampaignId(campaignId);
  const budget = validDailyBudgetMinor(dailyBudgetMinor);
  const result = await runIdempotentMutation(tenantId, idempotencyKey, 'update_campaign_budget', id, async () => {
    await assertCampaignBelongsToAccount(credentials, id);
    await graphRequest<Record<string, unknown>>(`${id}`, 'POST', { daily_budget: String(budget) }, credentials.accessToken);
    return { id, dailyBudgetMinor: budget };
  });
  return payloadToCampaign(result);
}

function payloadToCampaign(payload: Record<string, unknown>): MetaManagedCampaign {
  return {
    id: String(payload.id || ''),
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.objective === 'string' ? { objective: payload.objective as MetaClickToWhatsAppObjective } : {}),
    ...(payload.status === 'PAUSED' || payload.status === 'ACTIVE' || payload.status === 'ARCHIVED'
      ? { status: payload.status }
      : {}),
    ...(typeof payload.dailyBudgetMinor === 'number' ? { dailyBudgetMinor: payload.dailyBudgetMinor } : {}),
  };
}

export function metaAdsManagementLimits() {
  return { maxDailyBudgetMinor: MAX_DAILY_BUDGET_MINOR, maxCampaignNameLength: MAX_CAMPAIGN_NAME_LENGTH };
}
