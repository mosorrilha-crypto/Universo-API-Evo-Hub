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
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveTenantId } from '../middleware/rbac';

interface FinancialRouterDeps {
  authenticateToken: RequestHandler;
}

/** tenantId de verdade da requisição — vem do JWT, exceto pra saas_admin usando o seletor de tenant do painel (ver resolveTenantId em middleware/rbac.ts). */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'Transferência Bancária', 'Cartão de Crédito', 'Boleto Bancário', 'Link WhatsApp'];
const PAYMENT_STATUSES: PaymentStatus[] = ['pago', 'pendente', 'atrasado', 'cancelado'];
const ENTRY_TYPES: FinancialEntryType[] = ['income', 'expense'];

/**
 * Achado real em produção: o Financeiro (FinancialDashboard.tsx) era 100%
 * mock/localStorage — cobrança gerada nunca sobrevivia a um cache limpo nem
 * aparecia pra outro operador do mesmo tenant. Ver
 * supabase/migrations/0024_financial_transactions.sql pro design completo.
 */
export function createFinancialRouter({ authenticateToken }: FinancialRouterDeps): Router {
  const router = Router();

  router.get('/api/financial/transactions', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const transactions = await listFinancialTransactions(tenantOf(req));
    res.json({ transactions });
  }));

  router.post('/api/financial/transactions', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id, leadId, leadName, leadPhone, productName, amount, paymentMethod, status, date, operatorName, channel, pixQrCode, paymentLinkUrl, entryType } = req.body || {};

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
    });
    res.json({ transaction });
  }));

  router.patch('/api/financial/transactions/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status } = req.body || {};
    if (!PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status inválido — esperado um de: ${PAYMENT_STATUSES.join(', ')}.` });
    }
    const transaction = await updateFinancialTransactionStatus(tenantOf(req), req.params.id, status);
    if (!transaction) return res.status(404).json({ error: 'Transação não encontrada.' });
    res.json({ transaction });
  }));

  router.delete('/api/financial/transactions/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteFinancialTransaction(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  return router;
}
