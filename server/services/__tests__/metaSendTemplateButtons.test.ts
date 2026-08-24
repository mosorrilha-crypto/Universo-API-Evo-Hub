/**
 * Achado real CONFIRMADO em produção (20/08/2026, ver reminderJob.ts): botões
 * interativos de texto livre (`sendWhatsAppInteractiveButtons`) só funcionam
 * DENTRO da janela de 24h da Meta — um lembrete proativo precisa de um
 * TEMPLATE aprovado. `sendWhatsAppTemplateMessage` ganhou um parâmetro
 * opcional `buttonPayloads` pra cobrir templates com botões quick-reply: o
 * texto do botão já está fixo no template aprovado, só o `payload` de cada
 * um viaja aqui.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppTemplateMessage } from '../metaSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendWhatsAppTemplateMessage — botões quick-reply', () => {
  it('monta um componente button/quick_reply por payload, na ordem recebida', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.123' }] }) }));
    global.fetch = fetchMock as any;

    const result = await sendWhatsAppTemplateMessage(
      'pn', 'tok', '595981111111', 'lembrete_agendamento_es', 'es', ['hoy', '11:00'],
      ['lembrete_confirmar', 'lembrete_remarcar']
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '595981111111',
      type: 'template',
      template: {
        name: 'lembrete_agendamento_es',
        language: { code: 'es' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'hoy' }, { type: 'text', text: '11:00' }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'lembrete_confirmar' }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'lembrete_remarcar' }] },
        ],
      },
    });
    expect(result).toEqual({ messageId: 'wamid.123' });
  });

  it('sem buttonPayloads, manda só o componente body (compatível com os call sites existentes)', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.456' }] }) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppTemplateMessage('pn', 'tok', '595981111111', 'whatsapp_desconectado_alerta', 'pt_BR', ['Studio X']);

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Studio X' }] },
    ]);
  });
});
