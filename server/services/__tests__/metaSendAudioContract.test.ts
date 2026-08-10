import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadWhatsAppMedia, sendWhatsAppMediaMessage, sendWhatsAppAudioMessage } from '../metaSend';

global.fetch = vi.fn();

describe('metaSend — Contrato de Áudio da Graph API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploadWhatsAppMedia deve falhar se faltarem parâmetros críticos', async () => {
    const buf = Buffer.from('test');
    await expect(uploadWhatsAppMedia(undefined, 'tok', buf, 'audio/ogg', 'a.ogg')).rejects.toThrow('META_PHONE_NUMBER_ID ausente');
    await expect(uploadWhatsAppMedia('pn', undefined, buf, 'audio/ogg', 'a.ogg')).rejects.toThrow('META_ACCESS_TOKEN ausente');
    await expect(uploadWhatsAppMedia('pn', 'tok', Buffer.alloc(0), 'audio/ogg', 'a.ogg')).rejects.toThrow('Buffer da mídia ausente');
  });

  it('sendWhatsAppAudioMessage deve executar o fluxo completo (upload + send)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'media-123' })
    });

    const buf = Buffer.from('fake-audio');
    const mediaId = await sendWhatsAppAudioMessage('pn', 'tok', '595981111111', buf, 'audio/ogg');

    expect(mediaId).toBe('media-123');
    // Duas chamadas: uma pro /media (upload) e outra pro /messages (send)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    // Verifica a segunda chamada (o envio da mensagem) — "voice: true" marca
    // como nota de voz de verdade (waveform), exigido pela Meta pra áudio
    // gravado no navegador.
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://graph.facebook.com/v23.0/pn/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '595981111111',
          type: 'audio',
          audio: { id: 'media-123', voice: true }
        })
      })
    );
  });

  it('uploadWhatsAppMedia deve enviar o MIME type completo no campo type e no Blob do arquivo', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'media-123' })
    });

    const buf = Buffer.from('fake-audio');
    await uploadWhatsAppMedia('pn', 'tok', buf, 'audio/ogg; codecs=opus', 'a.ogg');

    const lastCall = (global.fetch as any).mock.calls[0];
    const body = lastCall[1].body as FormData;

    expect(body.get('messaging_product')).toBe('whatsapp');
    // O campo "type" deve ser o MIME type completo — nunca uma categoria
    // genérica ("audio") — conforme contrato documentado da Meta.
    expect(body.get('type')).toBe('audio/ogg; codecs=opus');
    // O Blob da parte "file" carrega o mesmo MIME type completo, que o
    // FormData/undici nativos usam como Content-Type dessa parte.
    const filePart = body.get('file') as File;
    expect(filePart.type).toBe('audio/ogg; codecs=opus');
    expect(filePart.name).toBe('a.ogg');
  });
});
