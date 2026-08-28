import { Router, type RequestHandler } from 'express';
import {
  listFinancialTransactions,
  createFinancialTransaction,
  updateFinancialTransactionStatus,
  deleteFinancialTransaction,
  type PaymentMethod,
  type PaymentStatus,
  type FinancialEntryType,
} from '../services/financialStore';
import {
  listRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
} from '../services/recurringExpenseStore';
import {
  listFinancialCategories,
  createFinancialCategory,
  listFinancialAccounts,
  createFinancialAccount,
  listInventoryItems,
  createInventoryItem,
  listStockMovements,
  createStockAdjustment,
  listPurchaseOrders,
  createPurchaseOrder,
  receivePurchaseOrder,
  type FinancialCategoryKind,
  type FinancialAccountType,
  type InventoryItemType,
  type StockMovementType,
} from '../services/financialOperationsStore';
import {
  createFinancialTitle,
  listFinancialTitles,
  listFinancialTitleSettlements,
  settleFinancialTitle,
  type FinancialTitleDirection,
} from '../services/financialTitleStore';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRole, resolveTenantId } from '../middleware/rbac';
import { isFinancialModuleEnabledForCurrentTenant } from '../services/financialModuleAccess';

interface FinancialRouterDeps {
  authenticateToken: RequestHandler;
  /** Injeção de teste; em produção a decisão sempre vem do entitlement do tenant corrente. */
  isFinancialModuleEnabled?: (req: AuthenticatedRequest) => Promise<boolean>;
}

/** tenantId de verdade da requisição — vem do JWT, exceto pra saas_admin usando o seletor de tenant do painel (ver resolveTenantId em middleware/rbac.ts). */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'Transferência Bancária', 'Cartão de Crédito', 'Boleto Bancário', 'Link WhatsApp'];
const PAYMENT_STATUSES: PaymentStatus[] = ['pago', 'pendente', 'atrasado', 'cancelado'];
const ENTRY_TYPES: FinancialEntryType[] = ['income', 'expense'];
const CATEGORY_KINDS: FinancialCategoryKind[] = ['income', 'expense', 'cost'];
const ACCOUNT_TYPES: FinancialAccountType[] = ['cash', 'bank', 'digital_wallet', 'card'];
const INVENTORY_ITEM_TYPES: InventoryItemType[] = ['product', 'supply'];
const STOCK_ADJUSTMENT_TYPES: Extract<StockMovementType, 'adjustment_in' | 'adjustment_out' | 'loss'>[] = ['adjustment_in', 'adjustment_out', 'loss'];
const TITLE_DIRECTIONS: FinancialTitleDirection[] = ['payable', 'receivable'];

function requireFinancialModule(isFinancialModuleEnabled?: FinancialRouterDeps['isFinancialModuleEnabled']) {
  return asyncHandler(async (req: AuthenticatedRequest, res, next) => {
    // Resolve primeiro o tenant para respeitar o seletor permitido do
    // saas_admin e sincronizar o contexto RLS antes de consultar o contrato.
    tenantOf(req);
    // O SaaS Admin audita a plataforma e administra a liberação por tenant;
    // ele não perde visibilidade ao selecionar uma empresa bloqueada.
    if (req.user?.role === 'saas_admin') return next();
    const enabled = isFinancialModuleEnabled
      ? await isFinancialModuleEnabled(req)
      : await isFinancialModuleEnabledForCurrentTenant();
    if (!enabled) {
      return res.status(403).json({
        error: 'O módulo Financeiro não está habilitado para esta empresa. Solicite a liberação ao administrador da plataforma.',
        code: 'financial_module_disabled',
      });
    }
    next();
  });
}

/**
 * Achado real em produção: o Financeiro (FinancialDashboard.tsx) era 100%
 * mock/localStorage — cobrança gerada nunca sobrevivia a um cache limpo nem
 * aparecia pra outro operador do mesmo tenant. Ver
 * supabase/migrations/0024_financial_transactions.sql pro design completo.
 */
export function createFinancialRouter({ authenticateToken, isFinancialModuleEnabled }: FinancialRouterDeps): Router {
  const router = Router();

  router.get('/api/financial/transactions', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const transactions = await listFinancialTransactions(tenantOf(req));
    res.json({ transactions });
  }));

  router.post('/api/financial/transactions', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id, leadId, leadName, leadPhone, productName, amount, paymentMethod, status, date, operatorName, channel, pixQrCode, paymentLinkUrl, entryType, categoryId, accountId, notes } = req.body || {};

    if (typeof id !== 'string' || !id.trim()) return res.status(400).json({ error: 'id é obrigatório.' });
    if (typeof leadId !== 'string' || !leadId.trim()) return res.status(400).json({ error: 'leadId é obrigatório.' });
    if (typeof leadName !== 'string' || !leadName.trim()) return res.status(400).json({ error: 'leadName é obrigatório.' });
    if (typeof leadPhone !== 'string' || !leadPhone.trim()) return res.status(400).json({ error: 'leadPhone é obrigatório.' });
    if (typeof productName !== 'string' || !productName.trim()) return res.status(400).json({ error: 'productName é obrigatório.' });
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return res.status(400).json({ error: 'amount precisa ser um número.' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
    const resolvedStatus: PaymentStatus = PAYMENT_STATUSES.includes(status) ? status : 'pendente';
    const resolvedEntryType: FinancialEntryType = ENTRY_TYPES.includes(entryType) ? entryType : 'income';

    const transaction = await createFinancialTransaction(tenantOf(req), {
      id,
      leadId,
      leadName,
      leadPhone,
      productName,
      amount,
      paymentMethod,
      status: resolvedStatus,
      date: typeof date === 'string' && date ? date : new Date().toISOString(),
      operatorName: typeof operatorName === 'string' ? operatorName : undefined,
      channel: typeof channel === 'string' ? channel : undefined,
      pixQrCode: typeof pixQrCode === 'string' ? pixQrCode : undefined,
      paymentLinkUrl: typeof paymentLinkUrl === 'string' ? paymentLinkUrl : undefined,
      entryType: resolvedEntryType,
      categoryId: typeof categoryId === 'string' && categoryId ? categoryId : undefined,
      accountId: typeof accountId === 'string' && accountId ? accountId : undefined,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
    });
    res.json({ transaction });
  }));

  router.patch('/api/financial/transactions/:id', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status } = req.body || {};
    if (!PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status inválido — esperado um de: ${PAYMENT_STATUSES.join(', ')}.` });
    }
    const transaction = await updateFinancialTransactionStatus(tenantOf(req), req.params.id, status);
    if (!transaction) return res.status(404).json({ error: 'Transação não encontrada.' });
    res.json({ transaction });
  }));

  router.delete('/api/financial/transactions/:id', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteFinancialTransaction(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  // Títulos representam compromissos ou direitos previstos. Dinheiro realizado
  // só é criado no endpoint de baixa, evitando confundir fluxo projetado com saldo.
  router.get('/api/financial/titles', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ titles: await listFinancialTitles(tenantOf(req)) });
  }));

  router.post('/api/financial/titles', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { direction, description, counterpartyName, counterpartyReference, originalAmount, issueDate, dueDate, competenceDate, paymentMethod, categoryId, notes } = req.body || {};
    if (!TITLE_DIRECTIONS.includes(direction)) return res.status(400).json({ error: `direction inválido — esperado um de: ${TITLE_DIRECTIONS.join(', ')}.` });
    if (typeof description !== 'string' || description.trim().length < 2 || description.trim().length > 180) return res.status(400).json({ error: 'description precisa ter entre 2 e 180 caracteres.' });
    if (typeof counterpartyName !== 'string' || counterpartyName.trim().length < 2 || counterpartyName.trim().length > 120) return res.status(400).json({ error: 'counterpartyName precisa ter entre 2 e 120 caracteres.' });
    if (counterpartyReference !== undefined && (typeof counterpartyReference !== 'string' || counterpartyReference.length > 120)) return res.status(400).json({ error: 'counterpartyReference, quando informado, precisa ter até 120 caracteres.' });
    if (typeof originalAmount !== 'number' || !Number.isFinite(originalAmount) || originalAmount <= 0) return res.status(400).json({ error: 'originalAmount precisa ser um número maior que zero.' });
    if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) return res.status(400).json({ error: 'dueDate precisa estar no formato ISO de data.' });
    if (issueDate !== undefined && (typeof issueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(issueDate))) return res.status(400).json({ error: 'issueDate, quando informado, precisa estar no formato ISO de data.' });
    if (competenceDate !== undefined && (typeof competenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(competenceDate))) return res.status(400).json({ error: 'competenceDate, quando informado, precisa estar no formato ISO de data.' });
    if (paymentMethod !== undefined && !PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
    if (categoryId !== undefined && (typeof categoryId !== 'string' || !categoryId)) return res.status(400).json({ error: 'categoryId, quando informado, precisa ser texto não vazio.' });
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) return res.status(400).json({ error: 'notes, quando informado, precisa ter até 1000 caracteres.' });
    try {
      const today = new Date().toISOString().slice(0, 10);
      res.status(201).json({ title: await createFinancialTitle(tenantOf(req), {
        direction, description: description.trim(), counterpartyName: counterpartyName.trim(),
        counterpartyReference: typeof counterpartyReference === 'string' && counterpartyReference.trim() ? counterpartyReference.trim() : undefined,
        originalAmount, issueDate: typeof issueDate === 'string' ? issueDate : today, dueDate,
        competenceDate: typeof competenceDate === 'string' ? competenceDate : undefined,
        paymentMethod, categoryId: typeof categoryId === 'string' ? categoryId : undefined,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
      }) });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Não foi possível criar o título financeiro.' });
    }
  }));

  router.get('/api/financial/titles/:id/settlements', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ settlements: await listFinancialTitleSettlements(tenantOf(req), req.params.id) });
  }));

  router.post('/api/financial/titles/:id/settlements', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { amount, financialAccountId, paymentMethod, settledAt, notes } = req.body || {};
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount precisa ser um número maior que zero.' });
    if (typeof financialAccountId !== 'string' || !financialAccountId) return res.status(400).json({ error: 'financialAccountId é obrigatório.' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
    if (settledAt !== undefined && (typeof settledAt !== 'string' || Number.isNaN(Date.parse(settledAt)))) return res.status(400).json({ error: 'settledAt, quando informado, precisa ser uma data ISO válida.' });
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) return res.status(400).json({ error: 'notes, quando informado, precisa ter até 1000 caracteres.' });
    try {
      res.status(201).json(await settleFinancialTitle(tenantOf(req), req.params.id, { amount, financialAccountId, paymentMethod, settledAt, notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined, operatorName: req.user?.name || 'Painel Financeiro' }));
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Não foi possível baixar o título.' });
    }
  }));

  router.get('/api/financial/categories', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ categories: await listFinancialCategories(tenantOf(req)) });
  }));

  router.post('/api/financial/categories', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, kind, color } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) return res.status(400).json({ error: 'name precisa ter entre 2 e 80 caracteres.' });
    if (!CATEGORY_KINDS.includes(kind)) return res.status(400).json({ error: `kind inválido — esperado um de: ${CATEGORY_KINDS.join(', ')}.` });
    if (color !== undefined && (typeof color !== 'string' || color.length > 20)) return res.status(400).json({ error: 'color, quando informado, precisa ser texto curto.' });
    res.status(201).json({ category: await createFinancialCategory(tenantOf(req), { name: name.trim(), kind, color }) });
  }));

  router.get('/api/financial/accounts', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ accounts: await listFinancialAccounts(tenantOf(req)) });
  }));

  router.post('/api/financial/accounts', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, accountType, openingBalance } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) return res.status(400).json({ error: 'name precisa ter entre 2 e 80 caracteres.' });
    if (!ACCOUNT_TYPES.includes(accountType)) return res.status(400).json({ error: `accountType inválido — esperado um de: ${ACCOUNT_TYPES.join(', ')}.` });
    if (typeof openingBalance !== 'number' || !Number.isFinite(openingBalance)) return res.status(400).json({ error: 'openingBalance precisa ser um número.' });
    res.status(201).json({ account: await createFinancialAccount(tenantOf(req), { name: name.trim(), accountType, openingBalance }) });
  }));

  router.get('/api/financial/inventory/items', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ items: await listInventoryItems(tenantOf(req)) });
  }));

  router.post('/api/financial/inventory/items', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, sku, itemType, unit, reorderPoint } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) return res.status(400).json({ error: 'name precisa ter entre 2 e 120 caracteres.' });
    if (sku !== undefined && (typeof sku !== 'string' || sku.trim().length > 80)) return res.status(400).json({ error: 'sku, quando informado, precisa ter até 80 caracteres.' });
    if (!INVENTORY_ITEM_TYPES.includes(itemType)) return res.status(400).json({ error: `itemType inválido — esperado um de: ${INVENTORY_ITEM_TYPES.join(', ')}.` });
    if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 16) return res.status(400).json({ error: 'unit é obrigatório e deve ter até 16 caracteres.' });
    if (typeof reorderPoint !== 'number' || !Number.isFinite(reorderPoint) || reorderPoint < 0) return res.status(400).json({ error: 'reorderPoint precisa ser um número não negativo.' });
    res.status(201).json({ item: await createInventoryItem(tenantOf(req), { name: name.trim(), sku: sku?.trim() || undefined, itemType, unit: unit.trim(), reorderPoint }) });
  }));

  router.get('/api/financial/inventory/movements', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const inventoryItemId = typeof req.query.inventoryItemId === 'string' ? req.query.inventoryItemId : undefined;
    res.json({ movements: await listStockMovements(tenantOf(req), inventoryItemId) });
  }));

  router.post('/api/financial/inventory/adjustments', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { inventoryItemId, movementType, quantity, unitCost, reason } = req.body || {};
    if (typeof inventoryItemId !== 'string' || !inventoryItemId) return res.status(400).json({ error: 'inventoryItemId é obrigatório.' });
    if (!STOCK_ADJUSTMENT_TYPES.includes(movementType)) return res.status(400).json({ error: `movementType inválido — esperado um de: ${STOCK_ADJUSTMENT_TYPES.join(', ')}.` });
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity precisa ser um número maior que zero.' });
    if (unitCost !== undefined && (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0)) return res.status(400).json({ error: 'unitCost, quando informado, precisa ser um número não negativo.' });
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'reason é obrigatório.' });
    try {
      res.status(201).json({ movement: await createStockAdjustment(tenantOf(req), { inventoryItemId, movementType, quantity, unitCost, reason: reason.trim() }) });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Não foi possível registrar o ajuste.' });
    }
  }));

  router.get('/api/financial/purchases', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ purchases: await listPurchaseOrders(tenantOf(req)) });
  }));

  router.post('/api/financial/purchases', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { supplierName, paymentMethod, notes, items } = req.body || {};
    if (typeof supplierName !== 'string' || supplierName.trim().length < 2 || supplierName.trim().length > 120) return res.status(400).json({ error: 'supplierName precisa ter entre 2 e 120 caracteres.' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) return res.status(400).json({ error: 'notes, quando informado, precisa ter até 1000 caracteres.' });
    if (!Array.isArray(items) || items.length === 0 || items.some((item) => !item || typeof item.inventoryItemId !== 'string' || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || typeof item.unitCost !== 'number' || !Number.isFinite(item.unitCost) || item.unitCost < 0)) return res.status(400).json({ error: 'items deve ter ao menos um item com inventoryItemId, quantity e unitCost válidos.' });
    try {
      res.status(201).json({ purchase: await createPurchaseOrder(tenantOf(req), { supplierName: supplierName.trim(), paymentMethod, notes, items }) });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Não foi possível criar a compra.' });
    }
  }));

  router.post('/api/financial/purchases/:id/receive', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ purchase: await receivePurchaseOrder(tenantOf(req), req.params.id) });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Não foi possível receber a compra.' });
    }
  }));

  // Despesas recorrentes (TASK-0097) — cadastra uma vez, o job diário
  // (recurringExpenseJob.ts) gera a financial_transaction sozinho todo mês
  // no dia de vencimento. Ver recurringExpenseStore.ts.
  router.get('/api/financial/recurring-expenses', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const recurringExpenses = await listRecurringExpenses(tenantOf(req));
    res.json({ recurringExpenses });
  }));

  router.post('/api/financial/recurring-expenses', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { description, amount, paymentMethod, dayOfMonth } = req.body || {};
    if (typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'description é obrigatório.' });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount precisa ser um número maior que zero.' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
    if (typeof dayOfMonth !== 'number' || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return res.status(400).json({ error: 'dayOfMonth precisa ser um número inteiro entre 1 e 28.' });
    }

    const recurringExpense = await createRecurringExpense(tenantOf(req), {
      description: description.trim(),
      amount,
      paymentMethod,
      dayOfMonth,
    });
    res.status(201).json({ recurringExpense });
  }));

  router.patch('/api/financial/recurring-expenses/:id', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { description, amount, paymentMethod, dayOfMonth, active } = req.body || {};
    const patch: Parameters<typeof updateRecurringExpense>[2] = {};
    if (description !== undefined) {
      if (typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'description, quando informado, precisa ser texto não vazio.' });
      patch.description = description.trim();
    }
    if (amount !== undefined) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount, quando informado, precisa ser um número maior que zero.' });
      patch.amount = amount;
    }
    if (paymentMethod !== undefined) {
      if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: `paymentMethod inválido — esperado um de: ${PAYMENT_METHODS.join(', ')}.` });
      patch.paymentMethod = paymentMethod;
    }
    if (dayOfMonth !== undefined) {
      if (typeof dayOfMonth !== 'number' || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        return res.status(400).json({ error: 'dayOfMonth, quando informado, precisa ser um número inteiro entre 1 e 28.' });
      }
      patch.dayOfMonth = dayOfMonth;
    }
    if (active !== undefined) {
      if (typeof active !== 'boolean') return res.status(400).json({ error: 'active, quando informado, precisa ser booleano.' });
      patch.active = active;
    }

    const recurringExpense = await updateRecurringExpense(tenantOf(req), req.params.id, patch);
    if (!recurringExpense) return res.status(404).json({ error: 'Despesa recorrente não encontrada.' });
    res.json({ recurringExpense });
  }));

  router.delete('/api/financial/recurring-expenses/:id', authenticateToken, requireFinancialModule(isFinancialModuleEnabled), requireRole('manager'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteRecurringExpense(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  return router;
}
