import { getDb } from './db';
import { createFinancialTransaction, type PaymentMethod } from './financialStore';

export type FinancialCategoryKind = 'income' | 'expense' | 'cost';
export type FinancialAccountType = 'cash' | 'bank' | 'digital_wallet' | 'card';
export type InventoryItemType = 'product' | 'supply';
export type StockMovementType = 'purchase_receipt' | 'sale' | 'service_consumption' | 'adjustment_in' | 'adjustment_out' | 'loss';
export type PurchaseStatus = 'draft' | 'receiving' | 'received' | 'cancelled';

export interface FinancialCategoryRecord { id: string; name: string; kind: FinancialCategoryKind; color?: string; active: boolean; }
export interface FinancialAccountRecord { id: string; name: string; accountType: FinancialAccountType; openingBalance: number; active: boolean; }
export interface InventoryItemRecord { id: string; name: string; sku?: string; itemType: InventoryItemType; unit: string; onHandQuantity: number; reorderPoint: number; averageUnitCost: number; active: boolean; }
export interface StockMovementRecord { id: string; inventoryItemId: string; movementType: StockMovementType; quantity: number; unitCost: number; reason?: string; sourceRef?: string; occurredAt: string; }
export interface PurchaseItemInput { inventoryItemId: string; quantity: number; unitCost: number; }
export interface PurchaseOrderRecord { id: string; supplierName: string; status: PurchaseStatus; paymentMethod: PaymentMethod; notes?: string; totalAmount: number; receivedAt?: string; financialTransactionId?: string; items?: PurchaseItemInput[]; }

const CATEGORY_COLUMNS = 'id, name, kind, color, active';
const ACCOUNT_COLUMNS = 'id, name, account_type, opening_balance, active';
const INVENTORY_COLUMNS = 'id, name, sku, item_type, unit, on_hand_quantity, reorder_point, average_unit_cost, active';
const STOCK_COLUMNS = 'id, inventory_item_id, movement_type, quantity, unit_cost, reason, source_ref, occurred_at';
const PURCHASE_COLUMNS = 'id, supplier_name, status, payment_method, notes, total_amount, received_at, financial_transaction_id';

const toCategory = (row: any): FinancialCategoryRecord => ({ id: row.id, name: row.name, kind: row.kind, color: row.color || undefined, active: row.active });
const toAccount = (row: any): FinancialAccountRecord => ({ id: row.id, name: row.name, accountType: row.account_type, openingBalance: Number(row.opening_balance), active: row.active });
const toInventoryItem = (row: any): InventoryItemRecord => ({ id: row.id, name: row.name, sku: row.sku || undefined, itemType: row.item_type, unit: row.unit, onHandQuantity: Number(row.on_hand_quantity), reorderPoint: Number(row.reorder_point), averageUnitCost: Number(row.average_unit_cost), active: row.active });
const toStockMovement = (row: any): StockMovementRecord => ({ id: row.id, inventoryItemId: row.inventory_item_id, movementType: row.movement_type, quantity: Number(row.quantity), unitCost: Number(row.unit_cost), reason: row.reason || undefined, sourceRef: row.source_ref || undefined, occurredAt: row.occurred_at });
const toPurchase = (row: any): PurchaseOrderRecord => ({ id: row.id, supplierName: row.supplier_name, status: row.status, paymentMethod: row.payment_method, notes: row.notes || undefined, totalAmount: Number(row.total_amount), receivedAt: row.received_at || undefined, financialTransactionId: row.financial_transaction_id || undefined });

export async function listFinancialCategories(tenantId: string) {
  const { data, error } = await getDb().from('financial_categories').select(CATEGORY_COLUMNS).eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data || []).map(toCategory);
}

export async function createFinancialCategory(tenantId: string, input: Omit<FinancialCategoryRecord, 'id' | 'active'> & { active?: boolean }) {
  const { data, error } = await getDb().from('financial_categories').insert({ id: crypto.randomUUID(), tenant_id: tenantId, name: input.name, kind: input.kind, color: input.color, active: input.active ?? true }).select(CATEGORY_COLUMNS).single();
  if (error) throw error;
  return toCategory(data);
}

export async function listFinancialAccounts(tenantId: string) {
  const { data, error } = await getDb().from('financial_accounts').select(ACCOUNT_COLUMNS).eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data || []).map(toAccount);
}

export async function createFinancialAccount(tenantId: string, input: Omit<FinancialAccountRecord, 'id' | 'active'> & { active?: boolean }) {
  const { data, error } = await getDb().from('financial_accounts').insert({ id: crypto.randomUUID(), tenant_id: tenantId, name: input.name, account_type: input.accountType, opening_balance: input.openingBalance, active: input.active ?? true }).select(ACCOUNT_COLUMNS).single();
  if (error) throw error;
  return toAccount(data);
}

export async function listInventoryItems(tenantId: string) {
  const { data, error } = await getDb().from('inventory_items').select(INVENTORY_COLUMNS).eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data || []).map(toInventoryItem);
}

export async function createInventoryItem(tenantId: string, input: Omit<InventoryItemRecord, 'id' | 'onHandQuantity' | 'averageUnitCost' | 'active'> & Partial<Pick<InventoryItemRecord, 'onHandQuantity' | 'averageUnitCost' | 'active'>>) {
  const { data, error } = await getDb().from('inventory_items').insert({ id: crypto.randomUUID(), tenant_id: tenantId, name: input.name, sku: input.sku, item_type: input.itemType, unit: input.unit, on_hand_quantity: input.onHandQuantity ?? 0, reorder_point: input.reorderPoint, average_unit_cost: input.averageUnitCost ?? 0, active: input.active ?? true }).select(INVENTORY_COLUMNS).single();
  if (error) throw error;
  return toInventoryItem(data);
}

export async function listStockMovements(tenantId: string, inventoryItemId?: string) {
  let query = getDb().from('stock_movements').select(STOCK_COLUMNS).eq('tenant_id', tenantId).order('occurred_at', { ascending: false });
  if (inventoryItemId) query = query.eq('inventory_item_id', inventoryItemId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toStockMovement);
}

export async function createStockAdjustment(tenantId: string, input: { inventoryItemId: string; movementType: 'adjustment_in' | 'adjustment_out' | 'loss'; quantity: number; unitCost?: number; reason: string }) {
  const db = getDb();
  const { data: rawItem, error: itemError } = await db.from('inventory_items').select(INVENTORY_COLUMNS).eq('tenant_id', tenantId).eq('id', input.inventoryItemId).maybeSingle();
  if (itemError) throw itemError;
  if (!rawItem) throw new Error('Item de estoque não encontrado.');
  const item = toInventoryItem(rawItem);
  const isIncoming = input.movementType === 'adjustment_in';
  const nextQuantity = item.onHandQuantity + (isIncoming ? input.quantity : -input.quantity);
  if (nextQuantity < 0) throw new Error('A movimentação deixaria o estoque negativo.');
  const nextAverageCost = isIncoming && input.unitCost !== undefined && nextQuantity > 0
    ? ((item.onHandQuantity * item.averageUnitCost) + (input.quantity * input.unitCost)) / nextQuantity
    : item.averageUnitCost;
  const sourceRef = `stock-adjustment:${crypto.randomUUID()}`;
  const { data: movement, error: movementError } = await db.from('stock_movements').insert({ id: crypto.randomUUID(), tenant_id: tenantId, inventory_item_id: input.inventoryItemId, movement_type: input.movementType, quantity: input.quantity, unit_cost: input.unitCost ?? item.averageUnitCost, reason: input.reason, source_ref: sourceRef }).select(STOCK_COLUMNS).single();
  if (movementError) throw movementError;
  const { error: updateError } = await db.from('inventory_items').update({ on_hand_quantity: nextQuantity, average_unit_cost: nextAverageCost, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', input.inventoryItemId);
  if (updateError) throw updateError;
  return toStockMovement(movement);
}

export async function listPurchaseOrders(tenantId: string) {
  const { data, error } = await getDb().from('purchase_orders').select(PURCHASE_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toPurchase);
}

export async function createPurchaseOrder(tenantId: string, input: { supplierName: string; paymentMethod: PaymentMethod; notes?: string; items: PurchaseItemInput[] }) {
  const totalAmount = input.items.reduce((total, item) => total + (item.quantity * item.unitCost), 0);
  const id = crypto.randomUUID();
  const db = getDb();
  for (const item of input.items) {
    const { data: inventoryItem, error: inventoryError } = await db.from('inventory_items').select('id').eq('tenant_id', tenantId).eq('id', item.inventoryItemId).maybeSingle();
    if (inventoryError) throw inventoryError;
    if (!inventoryItem) throw new Error('Um item informado não pertence a esta empresa.');
  }
  const { data, error } = await db.from('purchase_orders').insert({ id, tenant_id: tenantId, supplier_name: input.supplierName, payment_method: input.paymentMethod, notes: input.notes, total_amount: totalAmount, status: 'draft' }).select(PURCHASE_COLUMNS).single();
  if (error) throw error;
  const { error: itemsError } = await db.from('purchase_order_items').insert(input.items.map((item) => ({ id: crypto.randomUUID(), tenant_id: tenantId, purchase_order_id: id, inventory_item_id: item.inventoryItemId, quantity: item.quantity, unit_cost: item.unitCost })));
  if (itemsError) throw itemsError;
  return { ...toPurchase(data), items: input.items };
}

export async function receivePurchaseOrder(tenantId: string, purchaseId: string) {
  const db = getDb();
  const { data: rawPurchase, error: purchaseError } = await db.from('purchase_orders').select(PURCHASE_COLUMNS).eq('tenant_id', tenantId).eq('id', purchaseId).maybeSingle();
  if (purchaseError) throw purchaseError;
  if (!rawPurchase) throw new Error('Compra não encontrada.');
  const purchase = toPurchase(rawPurchase);
  if (purchase.status !== 'draft') throw new Error('A compra já foi recebida, está em processamento ou foi cancelada.');
  const { data: claim, error: claimError } = await db.from('purchase_orders').update({ status: 'receiving', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', purchaseId).eq('status', 'draft').select(PURCHASE_COLUMNS).maybeSingle();
  if (claimError) throw claimError;
  if (!claim) throw new Error('A compra foi alterada por outro operador. Atualize a tela e tente novamente.');
  const { data: rawItems, error: itemsError } = await db.from('purchase_order_items').select('inventory_item_id, quantity, unit_cost').eq('tenant_id', tenantId).eq('purchase_order_id', purchaseId);
  if (itemsError) throw itemsError;
  for (const line of rawItems || []) {
    const { data: rawItem, error: itemError } = await db.from('inventory_items').select(INVENTORY_COLUMNS).eq('tenant_id', tenantId).eq('id', line.inventory_item_id).maybeSingle();
    if (itemError) throw itemError;
    if (!rawItem) throw new Error('Um item da compra não pertence a esta empresa.');
    const item = toInventoryItem(rawItem);
    const nextQuantity = item.onHandQuantity + Number(line.quantity);
    const nextAverageCost = nextQuantity === 0 ? 0 : ((item.onHandQuantity * item.averageUnitCost) + (Number(line.quantity) * Number(line.unit_cost))) / nextQuantity;
    const sourceRef = `purchase:${purchaseId}:item:${line.inventory_item_id}`;
    const { error: movementError } = await db.from('stock_movements').insert({ id: crypto.randomUUID(), tenant_id: tenantId, inventory_item_id: item.id, movement_type: 'purchase_receipt', quantity: line.quantity, unit_cost: line.unit_cost, reason: `Recebimento da compra ${purchaseId}`, source_ref: sourceRef });
    if (movementError) throw movementError;
    const { error: updateError } = await db.from('inventory_items').update({ on_hand_quantity: nextQuantity, average_unit_cost: nextAverageCost, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', item.id);
    if (updateError) throw updateError;
  }
  const expense = await createFinancialTransaction(tenantId, { id: crypto.randomUUID(), leadId: `supplier:${purchase.supplierName}`, leadName: purchase.supplierName, leadPhone: 'N/A', productName: `Compra de estoque — ${purchase.supplierName}`, amount: purchase.totalAmount, paymentMethod: purchase.paymentMethod, status: 'pendente', date: new Date().toISOString(), channel: 'Compra de estoque', sourceRef: `purchase:${purchaseId}`, entryType: 'expense' });
  const receivedAt = new Date().toISOString();
  const { data: received, error: receivedError } = await db.from('purchase_orders').update({ status: 'received', received_at: receivedAt, financial_transaction_id: expense.id, updated_at: receivedAt }).eq('tenant_id', tenantId).eq('id', purchaseId).select(PURCHASE_COLUMNS).single();
  if (receivedError) throw receivedError;
  return toPurchase(received);
}
