import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createFinancialTitle, listFinancialTitles, settleFinancialTitle } from '../financialTitleStore';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('financialTitleStore', () => {
  let supabase: ReturnType<typeof createFakeSupabase>;

  beforeEach(() => {
    supabase = createFakeSupabase({
      financial_accounts: [{ id: 'account-a', tenant_id: TENANT_A, name: 'Caixa principal', account_type: 'cash', opening_balance: 0, active: true }],
      financial_categories: [{ id: 'category-a', tenant_id: TENANT_A, name: 'Insumos', kind: 'expense', active: true }],
      financial_transactions: [],
    });
    initDb(supabase);
  });

  it('mantém previsão separada do realizado e permite baixa parcial', async () => {
    const title = await createFinancialTitle(TENANT_A, {
      direction: 'payable', description: 'Compra de materiais', counterpartyName: 'Fornecedor A',
      originalAmount: 100, issueDate: '2026-08-26', dueDate: '2026-09-10',
      paymentMethod: 'PIX', categoryId: 'category-a', sourceRef: 'purchase:test-1',
    });
    expect(title).toMatchObject({ direction: 'payable', status: 'open', originalAmount: 100, openAmount: 100 });
    expect(supabase.__tables.financial_transactions).toHaveLength(0);

    const firstSettlement = await settleFinancialTitle(TENANT_A, title.id, { amount: 40, financialAccountId: 'account-a', paymentMethod: 'PIX' });
    expect(firstSettlement.title).toMatchObject({ status: 'partial', openAmount: 60 });
    expect(supabase.__tables.financial_transactions).toHaveLength(1);
    expect(supabase.__tables.financial_transactions[0]).toMatchObject({ entry_type: 'expense', status: 'pago', amount: 40, account_id: 'account-a' });

    const finalSettlement = await settleFinancialTitle(TENANT_A, title.id, { amount: 60, financialAccountId: 'account-a', paymentMethod: 'PIX' });
    expect(finalSettlement.title).toMatchObject({ status: 'settled', openAmount: 0 });
    expect(supabase.__tables.financial_title_settlements).toHaveLength(2);
  });

  it('não permite categoria ou conta financeira de outro tenant', async () => {
    await expect(createFinancialTitle(TENANT_B, {
      direction: 'receivable', description: 'Serviço confirmado', counterpartyName: 'Cliente B',
      originalAmount: 50, issueDate: '2026-08-26', dueDate: '2026-08-30', categoryId: 'category-a',
    })).rejects.toThrow('não pertence a esta empresa');

    const title = await createFinancialTitle(TENANT_A, {
      direction: 'receivable', description: 'Serviço confirmado', counterpartyName: 'Cliente A',
      originalAmount: 50, issueDate: '2026-08-26', dueDate: '2026-08-30',
    });
    await expect(settleFinancialTitle(TENANT_A, title.id, { amount: 50, financialAccountId: 'account-inexistente', paymentMethod: 'PIX' })).rejects.toThrow('não pertence a esta empresa');
  });

  it('expõe vencidos na leitura sem liquidá-los automaticamente', async () => {
    await createFinancialTitle(TENANT_A, {
      direction: 'receivable', description: 'Parcela antiga', counterpartyName: 'Cliente',
      originalAmount: 30, issueDate: '2025-01-01', dueDate: '2025-01-02',
    });
    const titles = await listFinancialTitles(TENANT_A);
    expect(titles[0]).toMatchObject({ status: 'overdue', openAmount: 30 });
    expect(supabase.__tables.financial_transactions).toHaveLength(0);
  });
});
