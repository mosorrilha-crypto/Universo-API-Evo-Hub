import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import {
  createFinancialCategory,
  createFinancialAccount,
  createInventoryItem,
  createPurchaseOrder,
  createStockAdjustment,
  listInventoryItems,
  receivePurchaseOrder,
} from '../financialOperationsStore';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('financialOperationsStore', () => {
  it('mantém categorias, contas e itens isolados por tenant', async () => {
    const category = await createFinancialCategory(TENANT_A, { name: 'Insumos', kind: 'cost' });
    const account = await createFinancialAccount(TENANT_A, { name: 'Caixa da loja', accountType: 'cash', openingBalance: 100 });
    await createInventoryItem(TENANT_A, { name: 'Lash Lift', sku: 'LASH-001', itemType: 'supply', unit: 'un', reorderPoint: 3 });

    expect(category.name).toBe('Insumos');
    expect(account.openingBalance).toBe(100);
    expect(await listInventoryItems(TENANT_B)).toEqual([]);
  });

  it('recebe uma compra, atualiza o estoque e gera uma despesa pendente rastreável', async () => {
    const item = await createInventoryItem(TENANT_A, { name: 'Henna castanho', itemType: 'supply', unit: 'un', reorderPoint: 2 });
    const purchase = await createPurchaseOrder(TENANT_A, {
      supplierName: 'Fornecedor Beauty',
      paymentMethod: 'PIX',
      items: [{ inventoryItemId: item.id, quantity: 5, unitCost: 12 }],
    });

    const received = await receivePurchaseOrder(TENANT_A, purchase.id);
    const items = await listInventoryItems(TENANT_A);

    expect(received.status).toBe('received');
    expect(items[0]).toMatchObject({ onHandQuantity: 5, averageUnitCost: 12 });
  });

  it('impede ajuste de saída que deixaria o estoque negativo', async () => {
    const item = await createInventoryItem(TENANT_A, { name: 'Pigmento', itemType: 'supply', unit: 'ml', reorderPoint: 1 });

    await expect(createStockAdjustment(TENANT_A, {
      inventoryItemId: item.id,
      movementType: 'adjustment_out',
      quantity: 1,
      reason: 'Avaria',
    })).rejects.toThrow('estoque negativo');
  });
});
