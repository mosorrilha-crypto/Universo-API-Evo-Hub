/**
 * Achado real em produção (28/08/2026): uma imagem recebida com legenda
 * digitada pelo cliente chegava no painel só como "📷 Imagem recebida" —
 * o parser nunca extraía `image.caption` do payload da Meta Cloud API.
 */
import { describe, expect, it } from 'vitest';
import { parseMetaWebhookPayload } from '../webhookParsers';

function metaImagePayload(image: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: 'phone-1' },
          contacts: [{ wa_id: '595981111111', profile: { name: 'Cliente' } }],
          messages: [{ id: 'wamid-1', from: '595981111111', type: 'image', image }],
        },
      }],
    }],
  };
}

describe('parseMetaWebhookPayload — legenda de imagem', () => {
  it('extrai a legenda quando a imagem chega com caption', () => {
    const [msg] = parseMetaWebhookPayload(metaImagePayload({ id: 'media-1', mime_type: 'image/jpeg', caption: '1ª Corrida Elas em Movimento — 11/10/2026' }));
    expect(msg.type).toBe('image');
    expect(msg.metaImage).toEqual({ mediaId: 'media-1', mimeType: 'image/jpeg' });
    expect(msg.caption).toBe('1ª Corrida Elas em Movimento — 11/10/2026');
  });

  it('não define caption quando a imagem chega sem legenda', () => {
    const [msg] = parseMetaWebhookPayload(metaImagePayload({ id: 'media-2', mime_type: 'image/jpeg' }));
    expect(msg.type).toBe('image');
    expect(msg.caption).toBeUndefined();
  });

  it('ignora caption em branco (só espaços)', () => {
    const [msg] = parseMetaWebhookPayload(metaImagePayload({ id: 'media-3', mime_type: 'image/jpeg', caption: '   ' }));
    expect(msg.caption).toBeUndefined();
  });
});
