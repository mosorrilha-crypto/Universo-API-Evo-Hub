/**
 * Refinamento do benchmark de mercado: botões de resposta rápida (ver
 * reminderJob.ts) — a maior causa de no-show é dificuldade de remarcar fora
 * do horário comercial, e um botão resolve isso num toque em vez do cliente
 * precisar digitar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppInteractiveButtons } from '../metaSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('sendWhatsAppInteractiveButtons', () => {
  it('monta o payload interactive/button certinho, com messaging_product e to', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: any) => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as any;

    await sendWhatsAppInteractiveButtons('pn', 'tok', '595981111111', 'Seu horário é hoje às 14:00', [
      { id: 'confirmar', title: '✅ Confirmar' },
      { id: 'remarcar', title: '🔄 Remarcar' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as any).body);
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '595981111111',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Seu horário é hoje às 14:00' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'confirmar', title: '✅ Confirmar' } },
            { type: 'reply', reply: { id: 'remarcar', title: '🔄 Remarcar' } },
          ],
        },
      },
    });
  });

  it('rejeita 0 ou mais de 3 botões (limite da própria Meta)', async () => {
    global.fetch = vi.fn() as any;
    await expect(sendWhatsAppInteractiveButtons('pn', 'tok', '5959811', 'oi', [])).rejects.toThrow(/1 a 3 botões/);
    await expect(
      sendWhatsAppInteractiveButtons('pn', 'tok', '5959811', 'oi', [
        { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' },
      ])
    ).rejects.toThrow(/1 a 3 botões/);
  });

  it('lança erro claro quando faltam credenciais Meta', async () => {
    global.fetch = vi.fn() as any;
    await expect(sendWhatsAppInteractiveButtons(undefined, undefined, '5959811', 'oi', [{ id: 'a', title: 'A' }])).rejects.toThrow(/META_PHONE_NUMBER_ID/);
  });
});
