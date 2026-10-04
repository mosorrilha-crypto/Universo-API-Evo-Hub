/**
 * TASK-0452 — achado real (auditoria + relato direto do dono do produto:
 * "fotos comuns estão sendo classificadas como comprovante"). webhooks.ts já
 * chamava analyzePaymentReceiptWithGemini (paymentReceiptAnalysis.ts) pra
 * analisar o CONTEÚDO de qualquer imagem recebida enquanto o contato tem um
 * agendamento aguardando pagamento — mas o resultado `looksLikeReceipt`
 * nunca era usado pra decidir nada, só o texto da dica (`hint`) entrava,
 * cosmético. Resultado: QUALQUER foto (selfie, print qualquer, pet) chegando
 * nessa janela virava "possível comprovante de pagamento" — marcava
 * payment_status='pending_verification' e abria um escalonamento à toa.
 * Corrigido: só trata como comprovante quando a análise não rodou/falhou
 * (fallback seguro de sempre) OU quando ela roda e diz que SIM parece
 * comprovante; quando ela roda e diz explicitamente que não, a imagem fica
 * como mensagem normal.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { setAppointmentForPhone, getAppointmentForPhone } from '../../services/appointmentStore';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { initDb } from '../../services/db';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // LEGACY_DEFAULT_TENANT_ID
const INSTANCE_NAME = 'test-instance';
const PHONE = '595981234567';

type ReceiptAnalysisResult = { looksLikeReceipt: boolean; hint: string } | null;
let analyzeMock: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<ReceiptAnalysisResult>>>;

vi.mock('../../services/mediaDownload', () => ({
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'ZmFrZQ==', mimeType: 'image/jpeg' })),
  downloadMetaMedia: vi.fn(async () => ({ base64: 'ZmFrZQ==', mimeType: 'image/jpeg' })),
  withMediaDownloadRetry: (download: () => Promise<unknown>) => download(),
}));

vi.mock('../../services/paymentReceiptAnalysis', () => ({
  analyzePaymentReceiptWithGemini: (...args: unknown[]) => analyzeMock(...args),
}));

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({
    metaWebhookVerifyToken: 'verify-token',
    evolutionInstanceName: INSTANCE_NAME,
    evolutionApiUrl: 'https://fake-evolution.test',
    evolutionApiKey: 'fake-key',
  }));

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

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
  analyzeMock = vi.fn<(...args: unknown[]) => Promise<ReceiptAnalysisResult>>();
});

function evolutionImagePayload(messageId: string) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE_NAME,
    data: {
      key: { id: messageId, remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false },
      pushName: 'Cliente',
      message: { imageMessage: {} },
    },
  };
}

async function flushBackgroundWork() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('webhook — foto comum não deve virar "possível comprovante de pagamento" (TASK-0452)', () => {
  it('análise diz que NÃO parece comprovante: não escala, não muda payment_status', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-1', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    analyzeMock.mockResolvedValue({ looksLikeReceipt: false, hint: 'foto de rosto/selfie' });

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionImagePayload('wamid-foto-comum-1')),
    });
    expect(res.status).toBe(200);
    await flushBackgroundWork();

    const escalations = (supabase.__tables.escalations || []).filter((e: any) => e.kind === 'payment_proof');
    expect(escalations).toHaveLength(0);

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentStatus).not.toBe('pending_verification');
  });

  it('análise diz que SIM parece comprovante: continua escalando e marcando pending_verification (sem regressão)', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-2', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    analyzeMock.mockResolvedValue({ looksLikeReceipt: true, hint: 'Transferência de Gs 50.000, 12/08' });

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionImagePayload('wamid-comprovante-real-1')),
    });
    expect(res.status).toBe(200);
    await flushBackgroundWork();

    const escalations = (supabase.__tables.escalations || []).filter((e: any) => e.kind === 'payment_proof');
    expect(escalations).toHaveLength(1);

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentStatus).toBe('pending_verification');
  });

  it('análise indisponível (Gemini falhou/null): mantém o fallback seguro de sempre e escala', async () => {
    await setAppointmentForPhone(TENANT_A, PHONE, { eventId: 'evt-3', summary: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' });
    analyzeMock.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionImagePayload('wamid-sem-analise-1')),
    });
    expect(res.status).toBe(200);
    await flushBackgroundWork();

    const escalations = (supabase.__tables.escalations || []).filter((e: any) => e.kind === 'payment_proof');
    expect(escalations).toHaveLength(1);

    const appt = await getAppointmentForPhone(TENANT_A, PHONE);
    expect(appt?.paymentStatus).toBe('pending_verification');
  });
});
