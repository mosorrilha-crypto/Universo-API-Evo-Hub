// @vitest-environment jsdom
// TASK-0468: conciliação do áudio provisório com o registro persistido.
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
const SENT_TEXT = '🎤 Áudio enviado';
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
      // O SSE busca o mesmo ID retornado pelo POST de mídia.
      return jsonResponse({
        messages: [{ id: REAL_ID, sender: 'agent', sentBy: 'operator', text: SENT_TEXT, type: 'audio', timestamp: new Date().toISOString() }],
      });
    }
    if (url === `/api/conversations/${PHONE}/send-media` && init?.method === 'POST') {
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


class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/mp4' }) });
    this.onstop?.();
  }
}
vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
} });
URL.createObjectURL = vi.fn(() => 'blob:recorded-audio');
URL.revokeObjectURL = vi.fn();

describe('WhatsAppLeadsSim — áudio enviado sem bolha duplicada', () => {
  it.each(['SSE primeiro', 'POST primeiro'])('%s mantém um único áudio confirmado', async (order) => {
    render(<AppPreferencesProvider><WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} /></AppPreferencesProvider>);
    await waitFor(() => expect(screen.getAllByText('Francisca Ibarra').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Francisca Ibarra')[0]);
    await screen.findByText('Por cuántos es el retoque de las cejas');
    fireEvent.click(screen.getByTitle('Gravar áudio real'));
    fireEvent.click(await screen.findByTitle(/Gravando pra Francisca/));
    fireEvent.click(await screen.findByTitle('Enviar áudio pra Francisca Ibarra'));
    await waitFor(() => expect(resolveSendPost).not.toBeNull());
    expect(screen.getAllByText('Tentar transcrever de novo')).toHaveLength(1);
    const receiveSse = async () => {
      await act(async () => {
        sseInstance?.onmessage?.({ data: JSON.stringify({ phone: PHONE }) });
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    const confirmPost = async () => {
      await act(async () => {
        resolveSendPost?.({ messageId: REAL_ID, conversation: { messages: [
          { id: REAL_ID, sender: 'agent', sentBy: 'operator', type: 'audio', text: SENT_TEXT, timestamp: new Date().toISOString() },
          // Outra mensagem simultânea não deve ser confundida com este envio.
          { id: 'other-send', sender: 'agent', sentBy: 'operator', type: 'text', text: 'Outro envio' },
        ] } });
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    if (order === 'SSE primeiro') {
      await receiveSse();
      await waitFor(() => expect(screen.getAllByText('Tentar transcrever de novo')).toHaveLength(2));
      await confirmPost();
    } else {
      await confirmPost();
      await receiveSse();
    }
    await waitFor(() => expect(screen.getAllByText('Tentar transcrever de novo')).toHaveLength(1));
    expect(screen.queryByText('Outro envio')).toBeNull();
  });
});
