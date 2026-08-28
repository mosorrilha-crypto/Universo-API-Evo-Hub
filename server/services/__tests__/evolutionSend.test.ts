/**
 * Epic 4.6 — envio real de texto via Evolution API (equivalente ao
 * metaSend.ts pra Meta Cloud API), seguindo a mesma convenção de chamada já
 * usada em mediaDownload.ts (downloadEvolutionMedia): `{apiUrl}/{endpoint}/{instance}`
 * com header `apikey`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEvolutionMediaMessage, sendEvolutionTextMessage, sendEvolutionVoiceMessage, showEvolutionTyping, setEvolutionWebhook } from '../evolutionSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendEvolutionTextMessage', () => {
  it('chama POST {apiUrl}/message/sendText/{instance} com apikey e o texto', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendEvolutionTextMessage('inst-1', 'https://evo.example.com/', 'key-1', '595981234567', 'Oi!');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.example.com/message/sendText/inst-1');
    expect((options as any).headers.apikey).toBe('key-1');
    expect(JSON.parse((options as any).body)).toEqual({ number: '595981234567', text: 'Oi!' });
  });

  it('lança erro quando a Evolution API responde com falha', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })) as any;
    await expect(sendEvolutionTextMessage('inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'Oi!')).rejects.toThrow(/HTTP 500/);
  });

  it('lança erro quando falta instância/URL/chave', async () => {
    await expect(sendEvolutionTextMessage(undefined, undefined, undefined, '595981234567', 'Oi!')).rejects.toThrow();
  });
});

describe('sendEvolutionVoiceMessage', () => {
  it('usa o endpoint PTT dedicado e fornece o áudio em Base64 puro com codificação habilitada', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({
      ok: true,
      json: async () => ({ key: { id: 'voice-123' } }),
    }));
    global.fetch = fetchMock as any;

    await sendEvolutionVoiceMessage('inst-1', 'https://evo.example.com/', 'key-1', '595981234567', 'T2dnUw==', 'audio/ogg; codecs=opus');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.example.com/message/sendWhatsAppAudio/inst-1');
    expect((options as any).headers.apikey).toBe('key-1');
    expect(JSON.parse((options as any).body)).toEqual({
      number: '595981234567',
      audio: 'T2dnUw==',
      encoding: true,
      delay: 1200,
    });
  });

  it('remove o cabeçalho Data URL e preserva somente os bytes Base64 enviados à Evolution', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendEvolutionVoiceMessage('inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'data:audio/ogg; codecs=opus;base64,T2dnUw==', 'audio/ogg; codecs=opus');

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse((options as any).body).audio).toBe('T2dnUw==');
  });

  it('propaga uma falha do endpoint PTT', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })) as any;
    await expect(sendEvolutionVoiceMessage('inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'T2dnUw==', 'audio/ogg; codecs=opus')).rejects.toThrow(/HTTP 500/);
  });
});

describe('sendEvolutionMediaMessage', () => {
  it('achado real 27/08/2026: remove o cabeçalho Data URL da foto de exemplo do catálogo antes de mandar pra Evolution API', async () => {
    // exampleImageBase64 do catálogo é salvo com o prefixo "data:...;base64,"
    // (vem direto do upload no navegador) — mandar isso pro campo `media` da
    // Evolution API sem limpar causava "Owned media must be a url or base64"
    // e derrubava silenciosamente o envio da foto de exemplo pro cliente.
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendEvolutionMediaMessage(
      'inst-1',
      'https://evo.example.com',
      'key-1',
      '595981234567',
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      'image/jpeg',
      'foto.jpg',
      'Lash Lift'
    );

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.example.com/message/sendMedia/inst-1');
    const body = JSON.parse((options as any).body);
    expect(body.media).toBe('/9j/4AAQSkZJRg==');
    expect(body.mediatype).toBe('image');
  });

  it('propaga uma falha da Evolution API com o corpo do erro', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: ['Owned media must be a url or base64'] }) })) as any;
    await expect(
      sendEvolutionMediaMessage('inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'data:image/jpeg;base64,QQ==', 'image/jpeg', 'foto.jpg')
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe('setEvolutionWebhook', () => {
  it('chama POST {apiUrl}/webhook/set/{instance} com apikey e a URL/eventos certos', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await setEvolutionWebhook('inst-1', 'https://evo.example.com/', 'key-1', 'https://universo.example.com/api/webhooks/evolution');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.example.com/webhook/set/inst-1');
    expect((options as any).headers.apikey).toBe('key-1');
    expect(JSON.parse((options as any).body)).toEqual({
      webhook: { enabled: true, url: 'https://universo.example.com/api/webhooks/evolution', events: ['MESSAGES_UPSERT'] },
    });
  });

  it('lança erro quando a Evolution API responde com falha', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })) as any;
    await expect(setEvolutionWebhook('inst-1', 'https://evo.example.com', 'key-1', 'https://universo.example.com/api/webhooks/evolution')).rejects.toThrow(/HTTP 500/);
  });

  it('lança erro quando falta instância/URL/chave', async () => {
    await expect(setEvolutionWebhook(undefined, undefined, undefined, 'https://universo.example.com/api/webhooks/evolution')).rejects.toThrow();
  });
});

describe('showEvolutionTyping', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('nunca lança mesmo se a chamada falhar (melhor esforço)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('rede fora');
    }) as any;
    await expect(showEvolutionTyping('inst-1', 'https://evo.example.com', 'key-1')).resolves.toBeUndefined();
  });

  it('não chama fetch quando faltam credenciais', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    await showEvolutionTyping(undefined, undefined, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
