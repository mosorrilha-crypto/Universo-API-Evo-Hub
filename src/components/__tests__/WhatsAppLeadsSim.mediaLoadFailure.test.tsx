// @vitest-environment jsdom
/**
 * TASK-0392 (pedido direto, prints reais do celular — "as imagens não estão
 * carregando"): a mesma mensagem (imagem recebida de um lead real) abria
 * normalmente no desktop mas mostrava "Imagem indisponível" no celular, sem
 * nenhum jeito de saber POR QUE (404? erro de rede daquele aparelho?) sem
 * acesso a devtools do próprio celular. `RealClientImage` (WhatsAppLeadsSim.tsx)
 * agora guarda e mostra o motivo real (status HTTP ou mensagem do erro) e
 * ganhou um botão "Tentar novamente" — cobre aqui: falha mostra o motivo,
 * clicar em tentar de novo refaz o fetch e, se a segunda tentativa for bem
 * sucedida, a imagem real aparece.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

const PHONE = '5511900000010';
const MESSAGE_ID = 'real-img-msg-1';

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

let mediaFetchAttempts = 0;

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(`/api/media/${MESSAGE_ID}`)) {
      mediaFetchAttempts += 1;
      if (mediaFetchAttempts === 1) {
        return { ok: false, status: 404 } as Response;
      }
      return { ok: true, status: 200, blob: async () => ({} as Blob) } as Response;
    }
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: PHONE,
            name: 'Cliente Com Foto',
            messages: [{ id: MESSAGE_ID, sender: 'lead', type: 'image', text: '📷 Imagem recebida', timestamp: new Date().toISOString() }],
            lastMessageId: MESSAGE_ID,
            lastMessageSender: 'lead',
            updatedAt: new Date().toISOString(),
            unreadCount: 0,
          },
        ],
      });
    }
    return jsonResponse({}, false);
  }),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}
if (!URL.createObjectURL) {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
}
URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

class FakeEventSource {
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mediaFetchAttempts = 0;
});

describe('WhatsAppLeadsSim — RealClientImage mostra o motivo da falha e permite tentar de novo', () => {
  it('exibe o status HTTP da falha e recupera a imagem ao clicar em "Tentar novamente"', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getByText(/Imagem indisponível \(HTTP 404\)/)).not.toBeNull());
    const retryButton = screen.getByText('Tentar novamente');

    await act(async () => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => expect(screen.queryByText(/Imagem indisponível/)).toBeNull());
    expect(screen.getByAltText('Imagem enviada pelo lead')).not.toBeNull();
    expect(mediaFetchAttempts).toBe(2);
  });
});
