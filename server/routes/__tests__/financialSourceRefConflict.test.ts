/**
 * TASK-0284: POST /api/financial/transactions precisa devolver 409 (não um
 * 500 genérico) quando createFinancialTransaction rejeita por violar a
 * constraint única (tenant_id, source_ref) — ex: o operador reanalisa ou
 * clica duas vezes na mesma imagem marcada como comprovante no chat.
 * Isolado do resto de financial.test.ts porque mocka financialStore
 * diretamente (o fake Supabase não simula constraint única de verdade).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const createFinancialTransaction = vi.fn();

vi.mock('../../services/financialStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/financialStore')>();
  return { ...actual, createFinancialTransaction };
});

const { createFinancialRouter } = await import('../financial');

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: 'tenant-a', role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({
    authenticateToken: fakeAuthenticateToken as any,
    isFinancialModuleEnabled: async () => true,
  }));
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Erro interno do servidor.' });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function postTransaction(sourceRef: string, id: string) {
  return fetch(`${baseUrl}/api/financial/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      leadId: 'chat-image',
      leadName: 'Cliente do WhatsApp',
      leadPhone: '595981111111',
      productName: 'Comprovante recebido no WhatsApp',
      amount: 75000,
      paymentMethod: 'PIX',
      status: 'pago',
      date: new Date().toISOString(),
      sourceRef,
    }),
  });
}

describe('POST /api/financial/transactions — conflito de sourceRef', () => {
  it('409 quando createFinancialTransaction rejeita com o código de violação de constraint única (23505)', async () => {
    createFinancialTransaction.mockRejectedValueOnce({ code: '23505' });

    const res = await postTransaction('chat-image:msg-456', 'tx-dup-1');

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/já existe/i);
  });

  it('propaga (500) um erro que NÃO é de duplicidade — não mascara falha real', async () => {
    createFinancialTransaction.mockRejectedValueOnce(new Error('Falha real de conexão com o banco'));

    const res = await postTransaction('chat-image:msg-789', 'tx-err-1');

    expect(res.status).toBe(500);
  });

  it('200 no caminho feliz (sem duplicidade)', async () => {
    createFinancialTransaction.mockResolvedValueOnce({ id: 'tx-ok-1', sourceRef: 'chat-image:msg-999' } as any);

    const res = await postTransaction('chat-image:msg-999', 'tx-ok-1');

    expect(res.status).toBe(200);
  });
});
