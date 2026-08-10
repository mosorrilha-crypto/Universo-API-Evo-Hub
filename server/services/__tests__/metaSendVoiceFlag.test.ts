/**
 * A Meta Cloud API distingue "voice message" de "basic audio message" via
 * um campo `voice: true` no objeto `audio` da mensagem. Adicionado como
 * hipótese pro erro 131053 persistente — confirmado depois (via GET
 * /{media_id} logo após o upload, comparando sha256) que não era a causa: o
 * arquivo chega intacto na Meta e o erro só aparece numa etapa de
 * processamento interna dela, depois do upload. `voice: true` só faz
 * sentido semanticamente pra Ogg/Opus (o único formato real de voice note
 * do WhatsApp) — pra outros formatos de áudio (ex: MP3, usado no
 * experimento de controle do 131053) a mensagem é um "áudio básico" normal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppMediaMessage } from '../metaSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendWhatsAppMediaMessage — voice:true pra áudio', () => {
  it('inclui voice:true no objeto audio pra Ogg/Opus (nota de voz de verdade)', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-id-1', 'audio/ogg; codecs=opus');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload.type).toBe('audio');
    expect(payload.audio).toEqual({ id: 'media-id-1', voice: true });
  });

  it('NÃO inclui voice pra MP3 (áudio básico, não é voice note)', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-id-3', 'audio/mpeg');

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload.type).toBe('audio');
    expect(payload.audio).toEqual({ id: 'media-id-3' });
    expect(payload.audio.voice).toBeUndefined();
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
