/**
 * TASK-0418 — achado real, print do painel (tenant Monique, cliente
 * "Angela"): "Hola soy Angela" e, mais de 10s depois (fora da janela de
 * silêncio do buffer de rajada — messageBuffer.ts), "Me gustaria saber más
 * sobre las cejas". A 1ª mensagem já tinha disparado o flush e começado a
 * gerar resposta ANTES de a 2ª existir; quando a resposta finalmente saiu
 * (Gemini + digitação simulada levam tempo), a cliente já tinha mandado a
 * 2ª — a resposta pareceu ignorar o que ela tinha acabado de dizer, mesmo
 * tendo sido gerada de boa-fé com o que existia até então (confirmado via
 * Supabase: msg2 chegou DEPOIS do flush de msg1, não fazia parte do mesmo
 * lote do buffer).
 *
 * Este teste reproduz a corrida via HTTP real (webhooks.ts + messageBuffer.ts
 * reais, timers falsos) controlando manualmente quando a 1ª chamada ao
 * gerador resolve — enquanto ela está "presa", a 2ª mensagem chega e abre um
 * buffer novo e independente. Mocka generateAutoReplyForText (mesmo padrão
 * de webhooksHistoryOrderRace.test.ts), reviewAutoReplyBeforeSend (sempre
 * aprova, não é o que este teste quer cobrir) e sendBubbles (captura o que
 * seria enviado, sem tentar rede de verdade).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
vi.mock('../../services/autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn();
vi.mock('../../services/conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/conversationStore')>();
  return { ...actual, getConversation };
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

function draftResult(bubbles: string[]) {
  return {
    phase: 'abertura' as const,
    bubbles,
    agent: 'triagem' as const,
    needsHumanConfirmation: false,
    stopAutoReply: false,
    routerElapsedMs: 0,
  };
}

let server: Server;
let baseUrl: string;

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
  initDb(createFakeSupabase());
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

describe('POST /webhook — absorve mensagem que chega durante a geração da resposta anterior (TASK-0418)', () => {
  it('regenera com o texto combinado em vez de mandar uma pergunta que a cliente já respondeu enquanto esperava', async () => {
    vi.useFakeTimers();
    const phone = '595986744930';

    getConversation.mockResolvedValue({
      phone,
      messages: [{ id: 'msg-1', sender: 'lead', type: 'text', text: 'Hola soy Angela', timestamp: 'x' }],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    // A 1ª chamada ao gerador fica "presa" até o teste resolver manualmente
    // — simula o tempo real que o Gemini leva, durante o qual a cliente
    // manda a 2ª mensagem.
    let resolveFirstCall: ((value: ReturnType<typeof draftResult>) => void) | null = null;
    generateAutoReplyForText.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstCall = resolve; })
    );
    generateAutoReplyForText.mockResolvedValueOnce(
      draftResult(['Hola Angela, un gusto', 'En cejas tenemos varias opciones, Angela'])
    );

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-1', 'Hola soy Angela')),
    });
    // Dispara o flush do buffer de "Hola soy Angela" — generateAutoReplyForText
    // é chamado e fica preso na promise controlada acima.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    expect(resolveFirstCall).not.toBeNull();

    // Enquanto a 1ª chamada ainda está presa (resposta ainda não gerada de
    // verdade), a cliente manda a 2ª mensagem — mais de 10s depois da 1ª,
    // fora da janela de silêncio que já tinha disparado o flush acima. Isso
    // abre um buffer NOVO e independente pra ela (o da 1ª já flushou).
    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-2', 'Me gustaria saber más sobre las cejas')),
    });

    // A 1ª chamada finalmente resolve — ainda dentro da janela de silêncio
    // do buffer da 2ª mensagem (que só flusharia sozinho 10s depois dela).
    resolveFirstCall!(draftResult(['Hola Angela, un gusto', '¿Qué servicio te gustaría consultar?']));
    await vi.advanceTimersByTimeAsync(100);

    // Absorção: a resposta da 1ª chamada (que reabriria uma pergunta já
    // respondida pela 2ª mensagem) nunca deveria ter sido enviada — o
    // gerador é chamado de novo, agora com as duas mensagens combinadas.
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
    const secondCallArgs = generateAutoReplyForText.mock.calls[1] as any[];
    expect(secondCallArgs[2]).toBe('Hola soy Angela\nMe gustaria saber más sobre las cejas'); // text combinado
    expect(secondCallArgs[14]).toBe(2); // messageCount atualizado (1 original + 1 absorvida)

    // Só a resposta final (regenerada com o texto completo) é enviada —
    // nunca a 1ª (stale), que perguntaria de novo o que a cliente já disse.
    expect(sendBubbles).toHaveBeenCalledTimes(1);
    const sentBubbles = (sendBubbles.mock.calls[0] as any[])[2];
    expect(sentBubbles).toEqual(['Hola Angela, un gusto', 'En cejas tenemos varias opciones, Angela']);

    // Nenhum buffer novo deveria continuar pendente pra essa mesma rajada
    // (a 2ª mensagem foi absorvida, não deixada pra flushar sozinha depois).
    await vi.advanceTimersByTimeAsync(15_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
  });
});
