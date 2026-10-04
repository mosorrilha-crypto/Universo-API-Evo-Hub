/**
 * TASK-0453 — achado de auditoria (backlog real de escalonamentos): num
 * tenant leadsOnly (TASK-0411/0412 — mesmo número de WhatsApp pessoal e
 * profissional), os gatilhos de palavra-chave `isPaymentRelated`/
 * `looksLikeHarassment` disparavam em cima de mensagem puramente pessoal só
 * por mencionar "pago"/"transferir"/"te amo" (achado real: namorada
 * dizendo "te amo", conversa sobre financiamento de carro) — inundando a
 * fila de escalonamento com ruído e escondendo os casos reais de cliente.
 *
 * Fix: pra tenant leadsOnly, esses dois gatilhos deixam de rodar
 * IMEDIATAMENTE (antes da IA) e passam a rodar só DEPOIS que
 * `generateAutoReplyForText` devolve `result.outOfScope` — se a própria IA
 * (seguindo a instrução de negócio do tenant) já confirmou que a mensagem é
 * pessoal, a escalação some; se confirmar que é do negócio, a escalação
 * continua acontecendo, só mais tarde. Pra tenant NÃO-leadsOnly (padrão,
 * número dedicado), nada muda — o gatilho continua imediato, nem espera a
 * IA responder.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
vi.mock('../../services/autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const reviewAutoReplyBeforeSend = vi.fn(async () => ({ approved: true, source: 'rules' as const, severity: 'low' as const, reason: 'ok' }));
vi.mock('../../services/replySafetyGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/replySafetyGate')>();
  return { ...actual, reviewAutoReplyBeforeSend };
});

const sendBubbles = vi.fn(async (_channel: any, _phone: string, bubbles: string[], onBubbleSent: (text: string) => Promise<void>) => {
  for (const bubble of bubbles) await onBubbleSent(bubble);
});
vi.mock('../../services/sendBubbles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/sendBubbles')>();
  return { ...actual, sendBubbles };
});

const { createWebhooksRouter } = await import('../webhooks');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');
const { setLeadsOnlyMode } = await import('../../services/agentStatus');

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // LEGACY_DEFAULT_TENANT_ID
const PHONE = '595986744930';
const PAYMENT_REASON = 'Mensagem sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana';
const HARASSMENT_REASON_PREFIX = '🚫 Mensagem de conteúdo pessoal/romântico';

function draftResult(outOfScope: boolean) {
  return {
    phase: 'abertura' as const,
    bubbles: outOfScope ? [] : ['Perfeito!'],
    agent: 'triagem' as const,
    needsHumanConfirmation: false,
    stopAutoReply: false,
    routerElapsedMs: 0,
    outOfScope,
  };
}

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({ metaWebhookVerifyToken: 'verify-token', getAi: () => ({} as any) }));
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
  vi.clearAllMocks();
  reviewAutoReplyBeforeSend.mockResolvedValue({ approved: true, source: 'rules', severity: 'low', reason: 'ok' });
});

afterEach(() => {
  vi.useRealTimers();
});

function metaTextPayload(from: string, messageId: string, text: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: {}, messages: [{ id: messageId, from, type: 'text', text: { body: text } }] } }] }],
  };
}

function paymentEscalations() {
  return (supabase.__tables.escalations || []).filter((e: any) => e.reason === PAYMENT_REASON);
}

function harassmentEscalations() {
  return (supabase.__tables.escalations || []).filter((e: any) => typeof e.reason === 'string' && e.reason.startsWith(HARASSMENT_REASON_PREFIX));
}

describe('webhook — gatilhos de pagamento/assédio por palavra-chave e leadsOnly (TASK-0453)', () => {
  it('tenant não-leadsOnly (padrão): escala IMEDIATAMENTE, nem espera a IA responder', async () => {
    vi.useFakeTimers();
    let resolveAi: ((value: ReturnType<typeof draftResult>) => void) | null = null;
    generateAutoReplyForText.mockImplementationOnce(() => new Promise((resolve) => { resolveAi = resolve; }));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(PHONE, 'msg-1', 'Ya pago, gracias')),
    });

    // A escalação já existe antes mesmo de disparar o buffer/IA — o gatilho
    // de palavra-chave roda sincronamente na recepção da mensagem.
    expect(paymentEscalations()).toHaveLength(1);

    // Deixa o ciclo terminar normalmente, sem deixar a promise presa.
    await vi.advanceTimersByTimeAsync(10_000);
    resolveAi?.(draftResult(false));
    await vi.advanceTimersByTimeAsync(100);
  });

  it('tenant leadsOnly + IA confirma outOfScope: nunca escala (mensagem pessoal de verdade)', async () => {
    vi.useFakeTimers();
    await setLeadsOnlyMode(TENANT_A, true);
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(true));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(PHONE, 'msg-2', 'Ya pago, gracias')),
    });

    // Imediatamente após a recepção, o gatilho NÃO deve ter disparado ainda
    // (foi adiado pra depois da IA).
    expect(paymentEscalations()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);

    // Mesmo depois da IA responder confirmando que é fora do escopo do
    // negócio, continua sem escalar — era mesmo ruído pessoal.
    expect(paymentEscalations()).toHaveLength(0);
  });

  it('tenant leadsOnly + IA confirma que É do negócio: escala do mesmo jeito, só mais tarde', async () => {
    vi.useFakeTimers();
    await setLeadsOnlyMode(TENANT_A, true);
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(false));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(PHONE, 'msg-3', 'Ya pago, gracias')),
    });

    expect(paymentEscalations()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);

    // A IA confirmou que é mensagem real do negócio — a escalação de
    // pagamento ainda precisa acontecer, só que depois da classificação.
    expect(paymentEscalations()).toHaveLength(1);
  });

  it('tenant leadsOnly + assédio: mesmo adiamento vale pro segundo gatilho', async () => {
    vi.useFakeTimers();
    await setLeadsOnlyMode(TENANT_A, true);
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(true));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(PHONE, 'msg-4', 'Te amo mi amor')),
    });

    expect(harassmentEscalations()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harassmentEscalations()).toHaveLength(0);
  });
});
