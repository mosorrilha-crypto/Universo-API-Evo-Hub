/**
 * Instagram DM (Fase 1, 15/08/2026) — envio real de texto via Instagram
 * Messaging API (equivalente ao evolutionSend.ts/metaSend.ts pros outros
 * provedores), POST {instagram-account-id}/messages com Bearer token.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { sendInstagramTextMessage, showInstagramTyping } from '../instagramSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendInstagramTextMessage', () => {
  it('chama POST /{instagramAccountId}/messages com Bearer token e recipient/message', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendInstagramTextMessage('ig-account-1', 'token-1', 'ig-user-abc', 'Oi!');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/ig-account-1/messages');
    expect((options as any).headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse((options as any).body)).toEqual({ recipient: { id: 'ig-user-abc' }, message: { text: 'Oi!' } });
  });

  it('lança erro quando a Instagram API responde com falha', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })) as any;
    await expect(sendInstagramTextMessage('ig-account-1', 'token-1', 'ig-user-abc', 'Oi!')).rejects.toThrow(/HTTP 500/);
  });

  it('lança erro quando falta ID da conta ou access token', async () => {
    await expect(sendInstagramTextMessage(undefined, undefined, 'ig-user-abc', 'Oi!')).rejects.toThrow();
  });
});

describe('showInstagramTyping', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('nunca lança mesmo se a chamada falhar (melhor esforço)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('rede fora');
    }) as any;
    await expect(showInstagramTyping('ig-account-1', 'token-1', 'ig-user-abc')).resolves.toBeUndefined();
  });

  it('não chama fetch quando faltam credenciais ou destinatário', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    await showInstagramTyping(undefined, undefined, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
