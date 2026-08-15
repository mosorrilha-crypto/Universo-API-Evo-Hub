/**
 * Instagram DM (Fase 1, 15/08/2026) — parser do formato "Messenger Platform"
 * (entry[].messaging[]), diferente do formato entry[].changes[].value.messages[]
 * da Meta Cloud API/WhatsApp usado por parseMetaWebhookPayload.
 */
import { describe, expect, it } from 'vitest';
import { parseInstagramWebhookPayload, friendlyLabelForOtherType } from '../webhookParsers';

describe('parseInstagramWebhookPayload', () => {
  it('extrai mensagem de texto com o ID da conta Instagram que recebeu', () => {
    const body = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-123',
          messaging: [
            { sender: { id: 'ig-user-abc' }, recipient: { id: 'ig-account-123' }, timestamp: 123, message: { mid: 'mid-1', text: 'Oi, quero saber o preço' } },
          ],
        },
      ],
    };
    const parsed = parseInstagramWebhookPayload(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      provider: 'instagram',
      messageId: 'mid-1',
      from: 'ig-user-abc',
      instagramAccountId: 'ig-account-123',
      type: 'text',
      text: 'Oi, quero saber o preço',
    });
    expect(parsed[0].fromMe).toBeUndefined();
  });

  it('marca fromMe:true quando message.is_echo é true (mensagem que a própria conta mandou)', () => {
    const body = {
      object: 'instagram',
      entry: [
        { id: 'ig-account-123', messaging: [{ sender: { id: 'ig-account-123' }, message: { mid: 'mid-echo', text: 'Resposta enviada por nós', is_echo: true } }] },
      ],
    };
    const parsed = parseInstagramWebhookPayload(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fromMe).toBe(true);
  });

  it('anexo sem texto vira type "other" com rawType "instagram_attachment"', () => {
    const body = {
      object: 'instagram',
      entry: [{ id: 'ig-account-123', messaging: [{ sender: { id: 'ig-user-abc' }, message: { mid: 'mid-2', attachments: [{ type: 'image' }] } }] }],
    };
    const parsed = parseInstagramWebhookPayload(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: 'other', rawType: 'instagram_attachment' });
  });

  it('ignora eventos sem message.mid ou sem sender.id', () => {
    const body = {
      object: 'instagram',
      entry: [{ id: 'ig-account-123', messaging: [{ sender: {}, message: { text: 'sem mid' } }, { message: { mid: 'mid-3', text: 'sem sender' } }] }],
    };
    expect(parseInstagramWebhookPayload(body)).toHaveLength(0);
  });

  it('devolve [] pra payload que não é do Instagram (object diferente)', () => {
    expect(parseInstagramWebhookPayload({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(parseInstagramWebhookPayload({})).toEqual([]);
    expect(parseInstagramWebhookPayload(null)).toEqual([]);
  });
});

describe('friendlyLabelForOtherType — rótulo do anexo do Instagram', () => {
  it('devolve um rótulo amigável específico pra instagram_attachment', () => {
    expect(friendlyLabelForOtherType('instagram_attachment')).toBe('📎 Anexo do Instagram recebido');
  });
});
