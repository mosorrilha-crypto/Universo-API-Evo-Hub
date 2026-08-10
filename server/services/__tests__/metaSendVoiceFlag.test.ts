/**
 * Achado ao investigar "o áudio sai mas não chega" (bug persistente mesmo
 * depois de confirmar que o Ogg/Opus gerado é válido e o multipart de
 * upload está correto): a Meta Cloud API distingue "voice message" de
 * "basic audio message" via um campo `voice: true` no objeto `audio` da
 * mensagem — nunca era enviado. Relatos de terceiros e a documentação
 * ligam a ausência desse campo a uma validação de formato diferente
 * (mais restrita/buggy) do lado da Meta, batendo com o erro 131053
 * ("processing it is of type application/octet-stream") reproduzido em
 * produção mesmo com um arquivo Ogg/Opus genuinamente válido.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppMediaMessage } from '../metaSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendWhatsAppMediaMessage — voice:true pra áudio', () => {
  it('inclui voice:true no objeto audio (toda nota de voz gravada pelo operador)', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-id-1', 'audio/ogg; codecs=opus');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload.type).toBe('audio');
    expect(payload.audio).toEqual({ id: 'media-id-1', voice: true });
  });

  it('NÃO inclui voice pra imagem (caption normal, sem o campo)', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-id-2', 'image/jpeg', 'legenda');

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload.type).toBe('image');
    expect(payload.image).toEqual({ id: 'media-id-2', caption: 'legenda' });
    expect(payload.image.voice).toBeUndefined();
  });
});
