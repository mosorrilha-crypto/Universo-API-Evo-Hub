/**
 * Achado real em produção: lead mandou sticker/reação e o painel mostrava
 * "[sticker]" cru, sem sentido nenhum pro operador — e a conversa nunca
 * recebia resposta nenhuma (comportamento mantido de propósito, mas o
 * rótulo precisa dizer o que realmente chegou).
 */
import { describe, expect, it } from 'vitest';
import { parseMetaWebhookPayload, friendlyLabelForOtherType } from '../webhookParsers';

function metaPayload(message: any) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn-1' }, messages: [message] } }] }],
  };
}

describe('parseMetaWebhookPayload — tipos não tratados (sticker, video/gif, etc.)', () => {
  it('captura rawType="sticker" pra mensagem de figurinha', () => {
    const [msg] = parseMetaWebhookPayload(metaPayload({ id: 'wamid-1', from: '595981234567', type: 'sticker', sticker: { id: 'stk-1', mime_type: 'image/webp' } }));
    expect(msg.type).toBe('other');
    expect(msg.rawType).toBe('sticker');
  });

  it('captura rawType="video" pra vídeo/gif', () => {
    const [msg] = parseMetaWebhookPayload(metaPayload({ id: 'wamid-2', from: '595981234567', type: 'video', video: { id: 'vid-1', mime_type: 'video/mp4' } }));
    expect(msg.type).toBe('other');
    expect(msg.rawType).toBe('video');
  });
});

describe('friendlyLabelForOtherType', () => {
  it('traduz sticker/video/location/reaction pra rótulo legível', () => {
    expect(friendlyLabelForOtherType('sticker')).toContain('Figurinha');
    expect(friendlyLabelForOtherType('video')).toContain('Vídeo/GIF');
    expect(friendlyLabelForOtherType('location')).toContain('Localização');
    expect(friendlyLabelForOtherType('reaction')).toContain('Reagiu');
  });

  it('cai num fallback genérico com o tipo bruto quando não reconhece', () => {
    expect(friendlyLabelForOtherType('order')).toBe('[order]');
    expect(friendlyLabelForOtherType(undefined)).toBe('[other]');
  });
});
