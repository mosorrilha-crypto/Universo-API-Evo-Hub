/**
 * Etapa 8 — endpoint pelo qual o operador (nunca a IA) marca um comprovante
 * de pagamento como verificado/rejeitado.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OPERATOR_ID = 'op-123';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: OPERATOR_ID, tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn',
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  supabase = createFakeSupabase({
    appointments: [
      { tenant_id: TENANT_ID, phone: '595981234567', event_id: 'evt-1', summary: 'Microlips', start_iso: '2026-08-10T10:00:00', end_iso: '2026-08-10T11:30:00', created_at: new Date().toISOString(), payment_status: 'pending_verification', payment_proof_message_id: 'msg-1', payment_verified_by: null, payment_verified_at: null },
    ],
  });
  initDb(supabase);
});

describe('POST /api/conversations/:phone/verify-payment', () => {
  it('marca verified e registra quem verificou', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981234567/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.appointment.paymentStatus).toBe('verified');
    expect(data.appointment.paymentVerifiedBy).toBe(OPERATOR_ID);
  });

  it('marca rejected', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981234567/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.appointment.paymentStatus).toBe('rejected');
  });

  it('rejeita status inválido', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981234567/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    expect(res.status).toBe(400);
  });

  it('404 quando não há agendamento ativo pra esse telefone', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/000000000/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(404);
  });
});
