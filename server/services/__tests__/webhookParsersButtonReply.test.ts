/**
 * Refinamento do benchmark de mercado (comparação com outros agentes de
 * WhatsApp): lembretes de agendamento ganharam botões de "Confirmar"/
 * "Remarcar" (ver reminderJob.ts, sendWhatsAppInteractiveButtons em
 * metaSend.ts). Quando o cliente toca um botão, a Meta manda de volta um
 * webhook `type: "interactive"` — precisa virar uma mensagem de texto normal
 * pro resto do pipeline (router, especialista) não precisar saber que veio
 * de um toque em vez de digitação.
 */
import { describe, expect, it } from 'vitest';
import { parseMetaWebhookPayload } from '../webhookParsers';

function metaPayload(message: any) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn-1' }, messages: [message] } }] }],
  };
}

describe('parseMetaWebhookPayload — resposta a botão interativo', () => {
  it('trata o título do botão tocado como mensagem de texto normal', () => {
    const [msg] = parseMetaWebhookPayload(metaPayload({
      id: 'wamid-btn-1',
      from: '595981234567',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'lembrete_remarcar', title: '🔄 Remarcar' } },
    }));
    expect(msg.type).toBe('text');
    expect(msg.text).toBe('🔄 Remarcar');
  });

  it('cai em "other" quando é interactive mas sem button_reply (ex: list_reply futuro, ainda não suportado)', () => {
    const [msg] = parseMetaWebhookPayload(metaPayload({
      id: 'wamid-btn-2',
      from: '595981234567',
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'x', title: 'Algo' } },
    }));
    expect(msg.type).toBe('other');
    expect(msg.rawType).toBe('interactive');
  });
});
