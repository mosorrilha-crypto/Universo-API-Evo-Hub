// @vitest-environment jsdom
/**
 * TASK-0417 (achado real, print do painel, tenant Monique — Evolution,
 * "Francisca Ibarra"): a mesma mensagem enviada manualmente pelo operador
 * ("¡Hola, amiga, el retoque de las cejas está Gs 150.000") apareceu
 * DUAS VEZES no painel, embora só exista UMA linha em `messages` no banco
 * (confirmado via Supabase) — ou seja, é um bug só de estado no cliente, não
 * de envio duplicado de verdade.
 *
 * Causa raiz: o servidor publica o evento SSE assim que grava a mensagem
 * enviada manualmente — ANTES de o próprio POST /send devolver a resposta
 * pro navegador que a originou. Se esse SSE chegar primeiro, `loadNewerMessages`
 * busca e anexa a mensagem real (id de verdade) na lista ANTES de o POST
 * original resolver — quando ele resolve, a reconciliação de TASK-0370
 * (trocar a bolha otimista pela real via id) cria uma SEGUNDA cópia da
 * mesma mensagem em vez de perceber que ela já está lá.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

const PHONE = '595983087518';
const SENT_TEXT = '¡Hola, amiga, el retoque de las cejas está Gs 150.000';
const REAL_ID = '3EB0E2071DB12E8322A016';

// Resolvida manualmente dentro do teste, pra controlar a ordem exata da
// corrida entre a resposta deste POST e o fetch disparado pelo SSE.
let resolveSendPost: ((body: unknown) => void) | null = null;

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: PHONE,
            name: 'Francisca Ibarra',
            messages: [{ id: 'm0', sender: 'lead', text: 'Por cuántos es el retoque de las cejas', timestamp: new Date().toISOString() }],
            lastMessageId: 'm0',
            lastMessageSender: 'lead',
            updatedAt: new Date().toISOString(),
            unreadCount: 0,
            lastLeadMessageAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (url === `/api/conversations/${PHONE}/messages?limit=30`) {
      return jsonResponse({
        messages: [{ id: 'm0', sender: 'lead', text: 'Por cuántos es el retoque de las cejas', timestamp: new Date().toISOString() }],
        hasMore: false,
      });
    }
    if (url.startsWith(`/api/conversations/${PHONE}/messages?after=`)) {
      // Simula o SSE vencendo a corrida: a mensagem real já aparece aqui,
      // com o id de verdade, ANTES de o POST /send abaixo resolver.
      return jsonResponse({
        messages: [{ id: REAL_ID, sender: 'agent', sentBy: 'operator', text: SENT_TEXT, timestamp: new Date().toISOString() }],
      });
    }
    if (url === `/api/conversations/${PHONE}/send` && init?.method === 'POST') {
      return new Promise((resolve) => {
        resolveSendPost = (body: unknown) => resolve(jsonResponse(body));
      });
    }
    return jsonResponse({}, false);
  }),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

let sseInstance: { onmessage: ((event: { data: string }) => void) | null } | null = null;
class FakeEventSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    sseInstance = this;
  }
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolveSendPost = null;
  sseInstance = null;
});

describe('WhatsAppLeadsSim — bolha duplicada ao enviar manualmente (TASK-0417)', () => {
  it('não duplica a bolha quando o SSE anexa a mensagem real antes de o POST /send resolver', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Francisca Ibarra').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Francisca Ibarra')[0]);

    // Espera o histórico (loadRealConversationHistory) carregar de verdade
    // (historyLoaded/newestLoadedMessageTimestamp), senão loadNewerMessages
    // (disparado pelo SSE abaixo) não faz nada.
    await screen.findByText('Por cuántos es el retoque de las cejas');

    const textarea = await screen.findByPlaceholderText('Digitar resposta...');
    fireEvent.change(textarea, { target: { value: SENT_TEXT } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Bolha otimista aparece na hora, com o texto — o <p> da bolha inclui o
    // texto E o rodapé de horário no mesmo nó (`{msg.text}{timeFooter}`),
    // por isso o matcher busca por conter o texto, não igualdade exata.
    const findBubbles = () => screen.findAllByText(
      (_content, element) => element?.tagName.toLowerCase() === 'p' && (element.textContent || '').includes(SENT_TEXT)
    );
    await findBubbles();

    // SSE "vence a corrida": chega e dispara loadNewerMessages, que já
    // busca e anexa a mensagem real (REAL_ID) — ANTES do POST /send abaixo
    // ser resolvido.
    await act(async () => {
      sseInstance?.onmessage?.({ data: JSON.stringify({ phone: PHONE }) });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Só agora o POST /send original resolve, com a MESMA mensagem real.
    await act(async () => {
      resolveSendPost?.({
        conversation: { messages: [{ id: REAL_ID, sender: 'agent', sentBy: 'operator', text: SENT_TEXT, timestamp: new Date().toISOString() }] },
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(async () => expect((await findBubbles()).length).toBe(1));
  });
});
