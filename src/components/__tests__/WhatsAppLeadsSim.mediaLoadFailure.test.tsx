// @vitest-environment jsdom
/**
 * TASK-0392 (pedido direto, prints reais do celular — "as imagens não estão
 * carregando"): a mesma mensagem (imagem recebida de um lead real) abria
 * normalmente no desktop mas mostrava "Imagem indisponível" no celular, sem
 * nenhum jeito de saber POR QUE (404? erro de rede daquele aparelho?) sem
 * acesso a devtools do próprio celular. `RealClientImage` (WhatsAppLeadsSim.tsx)
 * guarda e mostra o motivo real (status HTTP ou mensagem do erro) e tem um
 * botão "Tentar novamente" pra qualquer atraso maior que as tentativas
 * automáticas abaixo cobrem.
 *
 * TASK-0401 (achado real de continuação: imagens confirmadas salvas no R2 —
 * abriam normalmente no desktop — continuavam "indisponíveis" no celular
 * mesmo depois de um clique manual em "Tentar novamente"): a mensagem
 * aparece na conversa quase na hora (via SSE), enquanto o download real
 * (Evolution/Meta + upload pro R2, TASK-0398) roda em paralelo e pode levar
 * mais alguns segundos — mais do que o operador espera antes de desistir e
 * tentar de novo manualmente uma única vez. Agora `RealClientImage` tenta de
 * novo SOZINHO (sem expor nenhum estado de falha) por algumas tentativas
 * espaçadas antes de mostrar o botão manual como último recurso.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
// Quantas vezes a busca da mídia deve falhar (404) antes de finalmente
// devolver sucesso — cada teste ajusta esse valor conforme o cenário.
let failUntilAttempt = 1;

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(`/api/media/${MESSAGE_ID}`)) {
      mediaFetchAttempts += 1;
      if (mediaFetchAttempts <= failUntilAttempt) {
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
  vi.useRealTimers();
  mediaFetchAttempts = 0;
  failUntilAttempt = 1;
});

describe('WhatsAppLeadsSim — RealClientImage tenta de novo sozinho antes de desistir', () => {
  it('TASK-0401: uma falha transitória (404) se recupera sozinha, sem precisar clicar em nada', async () => {
    failUntilAttempt = 1; // falha só na primeira tentativa

    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    // Nenhum estado de falha deve aparecer pro operador — o auto-retry
    // (primeiro atraso: 2s) resolve sozinho antes de qualquer botão surgir.
    await waitFor(() => expect(screen.getByAltText('Imagem enviada pelo lead')).not.toBeNull(), { timeout: 3_000 });
    expect(screen.queryByText(/Imagem indisponível/)).toBeNull();
    expect(mediaFetchAttempts).toBe(2);
  });

  it('TASK-0401: uma falha persistente continua tentando sozinha (sem mostrar "Imagem indisponível") em vez de desistir já na primeira', async () => {
    failUntilAttempt = 100; // sempre falha, nesta janela de observação

    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    // Espera passar do primeiro atraso automático (2s) — chegando a pelo
    // menos uma 2ª tentativa — sem que o estado de falha jamais apareça.
    await waitFor(() => expect(mediaFetchAttempts).toBeGreaterThanOrEqual(2), { timeout: 4_000 });
    expect(screen.queryByText(/Imagem indisponível/)).toBeNull();
    expect(screen.getByText('Carregando imagem...')).not.toBeNull();
  });
});
