import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload, parseMetaWebhookPayload, parseInstagramWebhookPayload } from '../webhookParsers';

const original = '2026-11-05T11:55:00.000Z';
const seconds = Date.parse(original) / 1000;
function evolution(messageTimestamp?: unknown) {
  return { event: 'messages.upsert', instance: 'instance-test', data: {
    key: { id: 'message-test', remoteJid: '595981111111@s.whatsapp.net' },
    messageTimestamp, message: { conversation: 'mensagem antiga' },
  } };
}

describe('instante original nos parsers de webhook', () => {
  it.each([seconds, String(seconds), { low: seconds, high: 0, unsigned: true }])('Evolution normaliza segundos numéricos/string/Long (%j)', (value) => {
    expect(parseEvolutionWebhookPayload(evolution(value))[0].timestamp).toBe(original);
  });
  it('Meta normaliza timestamp em segundos', () => {
    const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
      messages: [{ id: 'meta-test', from: '595981111111', timestamp: String(seconds), type: 'text', text: { body: 'antiga' } }],
    } }] }] };
    expect(parseMetaWebhookPayload(body)[0].timestamp).toBe(original);
  });
  it('Instagram normaliza timestamp em milissegundos', () => {
    const body = { object: 'instagram', entry: [{ id: 'account', messaging: [{
      sender: { id: 'sender' }, timestamp: seconds * 1000, message: { mid: 'ig-test', text: 'antiga' },
    }] }] };
    expect(parseInstagramWebhookPayload(body)[0].timestamp).toBe(original);
  });
  it.each([undefined, null, '', 'invalid', 0, -1, Infinity, {}, { low: 'invalid', high: 0 }, 1e20])('não inventa instante para timestamp inválido (%j)', (value) => {
    expect(parseEvolutionWebhookPayload(evolution(value))[0].timestamp).toBeUndefined();
  });
});
