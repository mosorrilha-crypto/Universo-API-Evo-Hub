/**
 * Cobranças/transações financeiras por tenant — ver
 * supabase/migrations/0024_financial_transactions.sql pro raciocínio completo
 * (achado real: FinancialDashboard.tsx era 100% mock/localStorage, cobrança
 * gerada nunca sobrevivia a um cache limpo nem aparecia pra outro operador).
 */
import { getDb } from './db';

export type PaymentMethod = 'PIX' | 'Transferência Bancária' | 'Cartão de Crédito' | 'Boleto Bancário' | 'Link WhatsApp';
export type PaymentStatus = 'pago' | 'pendente' | 'atrasado' | 'cancelado';

export interface FinancialTransactionRecord {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  productName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  date: string;
  operatorName?: string;
  channel?: string;
  pixQrCode?: string;
  paymentLinkUrl?: string;
  /** Referência estável da origem (ex: "apt:<eventId do Google Calendar>") — só presente em transação criada automaticamente pelo verify-payment (ver conversations.ts). undefined pra qualquer transação registrada manualmente. Único por tenant (migration 0037) — garante que reenviar/reprocessar o mesmo verify-payment nunca duplica a transação. */
  sourceRef?: string;
}

type FinancialTransactionRow = {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  product_name: string;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  date: string;
  operator_name: string | null;
  channel: string | null;
  pix_qr_code: string | null;
  payment_link_url: string | null;
  source_ref: string | null;
};

const FINANCIAL_TRANSACTION_COLUMNS =
  'id, lead_id, lead_name, lead_phone, product_name, amount, payment_method, status, date, operator_name, channel, pix_qr_code, payment_link_url, source_ref';

function toFinancialTransactionRecord(row: FinancialTransactionRow): FinancialTransactionRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: row.lead_name,
    leadPhone: row.lead_phone,
    productName: row.product_name,
    amount: row.amount,
    paymentMethod: row.payment_method,
    status: row.status,
    date: row.date,
    operatorName: row.operator_name ?? undefined,
    channel: row.channel ?? undefined,
    pixQrCode: row.pix_qr_code ?? undefined,
    paymentLinkUrl: row.payment_link_url ?? undefined,
    sourceRef: row.source_ref ?? undefined,
  };
}

/** Todas as cobranças/transações já registradas pro tenant, mais recentes primeiro. */
export async function listFinancialTransactions(tenantId: string): Promise<FinancialTransactionRecord[]> {
  const db = getDb();
  const { data, error } = await db
    .from('financial_transactions')
    .select(FINANCIAL_TRANSACTION_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data as FinancialTransactionRow[]).map(toFinancialTransactionRecord);
}

export interface CreateFinancialTransactionInput {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  productName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  date: string;
  operatorName?: string;
  channel?: string;
  pixQrCode?: string;
  paymentLinkUrl?: string;
  sourceRef?: string;
}

/** true quando o erro é a constraint única (tenant_id, source_ref) da migration 0037 — sinal de que essa transação já foi criada antes (reentrega/retry), nunca um erro real. Quem chama pra criação automática (ver conversations.ts verify-payment) deve tratar isso como sucesso silencioso, não propagar. */
export function isDuplicateSourceRefError(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

/**
 * Insere uma cobrança nova. `id` vem do cliente (o app já monta o objeto
 * completo antes de enviar, mesmo padrão de outras entidades desta base) —
 * não é um upsert, uma cobrança nunca deveria ser "atualizada" na criação.
 */
export async function createFinancialTransaction(
  tenantId: string,
  input: CreateFinancialTransactionInput
): Promise<FinancialTransactionRecord> {
  const db = getDb();
  const { data, error } = await db
    .from('financial_transactions')
    .insert({
      id: input.id,
      tenant_id: tenantId,
      lead_id: input.leadId,
      lead_name: input.leadName,
      lead_phone: input.leadPhone,
      product_name: input.productName,
      amount: input.amount,
      payment_method: input.paymentMethod,
      status: input.status,
      date: input.date,
      operator_name: input.operatorName,
      channel: input.channel,
      pix_qr_code: input.pixQrCode,
      payment_link_url: input.paymentLinkUrl,
      source_ref: input.sourceRef,
    })
    .select(FINANCIAL_TRANSACTION_COLUMNS)
    .single();
  if (error) throw error;
  return toFinancialTransactionRecord(data as FinancialTransactionRow);
}

/** Atualiza só o status (ex: "Confirmar Pgto" no painel) — nunca reescreve o resto da cobrança. */
export async function updateFinancialTransactionStatus(
  tenantId: string,
  id: string,
  status: PaymentStatus
): Promise<FinancialTransactionRecord | null> {
  const db = getDb();
  const { data, error } = await db
    .from('financial_transactions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select(FINANCIAL_TRANSACTION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toFinancialTransactionRecord(data as FinancialTransactionRow) : null;
}

export async function deleteFinancialTransaction(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('financial_transactions').delete().eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}
