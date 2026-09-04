/**
 * TASK-0284: POST /api/conversations/:phone/messages/:messageId/analyze-payment-proof
 * — operador marca uma imagem do chat como comprovante de pagamento (menu
 * "⋮" do balão). Só analisa e devolve os campos extraídos; nunca cria ou
 * confirma nada sozinha (mesmo formato de retry-transcription).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const getMediaImage = vi.fn();
const extractPaymentProofDataWithGemini = vi.fn();

vi.mock('../../services/mediaImageStore', () => ({ getMediaImage, saveMediaImage: vi.fn() }));
vi.mock('../../services/paymentReceiptAnalysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/paymentReceiptAnalysis')>();
  return { ...actual, extractPaymentProofDataWithGemini };
});

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
      getAi: () => null,
    })
  );
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

const NOW = new Date().toISOString();

beforeEach(() => {
  getMediaImage.mockReset();
  extractPaymentProofDataWithGemini.mockReset();
  supabase = createFakeSupabase({
    conversations: [
      { id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: NOW, geo_restriction: null },
      { id: 'conv-x', tenant_id: TENANT_B, phone: '595989999999', name: 'Outro tenant', updated_at: NOW, geo_restriction: null },
    ],
    messages: [
      { id: 'msg-image-1', tenant_id: TENANT_A, conversation_id: 'conv-1', sender: 'lead', type: 'image', text: '📷 Imagem recebida', created_at: NOW, reply_to_message_id: null, forwarded_from_message_id: null, reactions: null },
      { id: 'msg-text-1', tenant_id: TENANT_A, conversation_id: 'conv-1', sender: 'lead', type: 'text', text: 'Oi', created_at: NOW, reply_to_message_id: null, forwarded_from_message_id: null, reactions: null },
      { id: 'msg-image-other-tenant', tenant_id: TENANT_B, conversation_id: 'conv-x', sender: 'lead', type: 'image', text: '📷 Imagem recebida', created_at: NOW, reply_to_message_id: null, forwarded_from_message_id: null, reactions: null },
    ],
  });
  initDb(supabase);
});

function analyze(phone: string, messageId: string) {
  return fetch(`${baseUrl}/api/conversations/${phone}/messages/${messageId}/analyze-payment-proof`, { method: 'POST' });
}

describe('POST /api/conversations/:phone/messages/:messageId/analyze-payment-proof', () => {
  it('404 quando a mensagem não existe', async () => {
    const res = await analyze('595981111111', 'msg-inexistente');
    expect(res.status).toBe(404);
  });

  it('400 quando a mensagem não é uma imagem', async () => {
    const res = await analyze('595981111111', 'msg-text-1');
    expect(res.status).toBe(400);
  });

  it('404 quando a imagem original não está mais disponível', async () => {
    getMediaImage.mockResolvedValue(null);
    const res = await analyze('595981111111', 'msg-image-1');
    expect(res.status).toBe(404);
  });

  it('devolve success:true e a extração quando a IA responde', async () => {
    getMediaImage.mockResolvedValue({ buffer: Buffer.from('fake-image'), contentType: 'image/jpeg' });
    extractPaymentProofDataWithGemini.mockResolvedValue({
      looksLikeReceipt: true,
      amount: 200000,
      currency: 'PYG',
      date: '2026-09-04',
      method: 'PIX',
      bankOrApp: 'Ueno',
      holderName: null,
      confidence: 'medium',
      hint: 'PIX de Gs 200.000',
    });

    const res = await analyze('595981111111', 'msg-image-1');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ success: true, extraction: { amount: 200000, method: 'PIX' } });
  });

  it('devolve success:false e extraction:null quando a extração falha — nunca inventa dado', async () => {
    getMediaImage.mockResolvedValue({ buffer: Buffer.from('fake-image'), contentType: 'image/jpeg' });
    extractPaymentProofDataWithGemini.mockResolvedValue(null);

    const res = await analyze('595981111111', 'msg-image-1');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: false, extraction: null });
  });

  it('nunca analisa mensagem de outro tenant (mesmo com o id certo)', async () => {
    const res = await analyze('595981111111', 'msg-image-other-tenant');
    expect(res.status).toBe(404);
    expect(extractPaymentProofDataWithGemini).not.toHaveBeenCalled();
  });
});
