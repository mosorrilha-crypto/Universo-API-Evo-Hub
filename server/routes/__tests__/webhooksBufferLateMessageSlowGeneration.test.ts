/**
 * TASK-0432 — achado real (tenant Monique, contato "😍", telefone
 * 595985868809): a cliente mandou "¡Hola! Quiero más información" e, 12s
 * depois, "Precio por favor" — fora da janela de 10s de silêncio do buffer
 * da 1ª mensagem (que já tinha flushado sozinho). A proteção de absorção de
 * mensagem tardia (TASK-0418, ver webhooksBufferLateMessage.test.ts) só
 * funciona se a mensagem nova AINDA ESTIVER no buffer no momento em que a
 * resposta anterior termina de ser gerada — mas gerar uma resposta real
 * (roteador + especialista + revisor) leva bem mais que os 10s de silêncio
 * do buffer seguinte (~30-40s observado em produção). O buffer da 2ª
 * mensagem já tinha disparado SOZINHO (seus próprios 10s já tinham vencido)
 * bem antes da 1ª geração terminar — quando a 1ª checou
 * takePendingBufferTexts, o buffer da 2ª já tinha sido retirado dali pelo
 * próprio flush dela (que ficou na fila de runExclusive esperando a vez).
 * Resultado real: 4 respostas separadas pra só 2 mensagens do cliente,
 * repetindo informação (preço) em sequência.
 *
 * O teste TASK-0418 já existente (webhooksBufferLateMessage.test.ts) nunca
 * cobriu esse caso: ele resolve a 1ª geração "presa" rápido o bastante
 * (100ms) pra o buffer da 2ª mensagem NUNCA vencer seus próprios 10s de
 * silêncio antes da absorção rodar. Este teste avança o tempo COMPLETO da
 * janela de silêncio da 2ª mensagem ANTES de resolver a 1ª geração —
 * reproduzindo a corrida real (generatingLock.ts/messageBuffer.ts: o flush
 * da 2ª mensagem deve ADIAR enquanto a 1ª ainda está gerando, em vez de
 * disparar por conta própria).
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

describe('POST /webhook — absorve mensagem tardia mesmo quando a geração da 1ª demora mais que a janela de silêncio da 2ª (TASK-0432)', () => {
  it('nunca deixa a 2ª mensagem disparar seu próprio ciclo — o flush dela adia até a 1ª geração terminar, e é absorvida', async () => {
    vi.useFakeTimers();
    const phone = '595985868809';

    getConversation.mockResolvedValue({
      phone,
      messages: [{ id: 'msg-1', sender: 'lead', type: 'text', text: '¡Hola! Quiero más información', timestamp: 'x' }],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    // A 1ª chamada ao gerador fica presa — simula o tempo real que uma
    // geração completa leva (roteador + especialista + revisor).
    let resolveFirstCall: ((value: ReturnType<typeof draftResult>) => void) | null = null;
    generateAutoReplyForText.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstCall = resolve; })
    );
    generateAutoReplyForText.mockResolvedValueOnce(
      draftResult(['Hola, todo bien? Soy Ana', 'La Micro de Cejas está Gs 550.000...'])
    );

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-1', '¡Hola! Quiero más información')),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    expect(resolveFirstCall).not.toBeNull();

    // 2ª mensagem chega enquanto a 1ª ainda está presa — abre seu próprio
    // buffer, independente do da 1ª (que já flushou).
    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-2', 'Precio por favor')),
    });

    // Passa os 10s COMPLETOS de silêncio da 2ª mensagem — no código antigo
    // (sem TASK-0432), isso disparava o flush dela AGORA, mesmo com a 1ª
    // geração ainda presa, gerando um 2º ciclo independente. Com a
    // correção, o flush deve ADIAR (generatingLock ainda marcado) em vez de
    // disparar.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1); // nada novo disparou sozinho

    // A 1ª geração finalmente termina.
    resolveFirstCall!(draftResult(['Hola, todo bien? Soy Ana', 'En qué te puedo ayudar?']));
    await vi.advanceTimersByTimeAsync(100);

    // Absorção: a checagem TASK-0418 (agora alcançável de verdade, já que o
    // flush da 2ª mensagem esperou) encontra "Precio por favor" ainda
    // pendente e regenera com o texto combinado.
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
    const secondCallArgs = generateAutoReplyForText.mock.calls[1] as any[];
    expect(secondCallArgs[2]).toBe('¡Hola! Quiero más información\nPrecio por favor');

    // Só UMA resposta é enviada no total — nunca as 2 respostas separadas e
    // redundantes do achado real.
    expect(sendBubbles).toHaveBeenCalledTimes(1);

    // Nenhum buffer novo continua pendente pra essa mesma rajada.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
  });
});
