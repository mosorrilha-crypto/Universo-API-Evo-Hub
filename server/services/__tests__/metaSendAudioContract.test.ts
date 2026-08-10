import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadWhatsAppMedia, sendWhatsAppMediaMessage } from '../metaSend';

global.fetch = vi.fn();

describe('metaSend — Contrato de Áudio da Graph API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploadWhatsAppMedia deve falhar se faltarem parâmetros críticos', async () => {
    await expect(uploadWhatsAppMedia(undefined, 'tok', 'base64', 'audio/ogg', 'a.ogg')).rejects.toThrow('META_PHONE_NUMBER_ID ausente');
    await expect(uploadWhatsAppMedia('pn', undefined, 'base64', 'audio/ogg', 'a.ogg')).rejects.toThrow('META_ACCESS_TOKEN ausente');
    await expect(uploadWhatsAppMedia('pn', 'tok', '', 'audio/ogg', 'a.ogg')).rejects.toThrow('Conteúdo da mídia (base64) ausente');
  });

  it('sendWhatsAppMediaMessage deve montar o payload correto para áudio (sem caption)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ messaging_product: 'whatsapp', contacts: [{ input: '595981111111', wa_id: '595981111111' }], messages: [{ id: 'wa-id' }] })
    });

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-123', 'audio/ogg', 'Legenda Ignorada');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/pn/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '595981111111',
          type: 'audio',
          audio: { id: 'media-123' }
        })
      })
    );
  });

  it('sendWhatsAppMediaMessage deve incluir caption para imagens', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'wa-id' })
    });

    await sendWhatsAppMediaMessage('pn', 'tok', '595981111111', 'media-456', 'image/jpeg', 'Uma bela foto');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/pn/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '595981111111',
          type: 'image',
          image: { id: 'media-456', caption: 'Uma bela foto' }
        })
      })
    );
  });
});
