/**
 * Epic 4.6 — sendBubbles precisa falar com o provedor certo (Meta Cloud API
 * ou Evolution API) conforme o canal resolvido pro tenant (Bloco 2.B /
 * resolveTenantByEvolutionInstance), sem misturar credencial de um provedor
 * com chamada do outro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendWhatsAppTextMessage = vi.fn(async () => undefined);
const markAsReadAndShowTyping = vi.fn(async () => undefined);
const sendEvolutionTextMessage = vi.fn(async () => undefined);
const showEvolutionTyping = vi.fn(async () => undefined);

vi.mock('../metaSend', () => ({ sendWhatsAppTextMessage, markAsReadAndShowTyping }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage, showEvolutionTyping }));

const { sendBubbles } = await import('../sendBubbles');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function runSendBubbles(...args: Parameters<typeof sendBubbles>) {
  const promise = sendBubbles(...args);
  await vi.runAllTimersAsync();
  await promise;
}

describe('sendBubbles — canal Meta vs Evolution (Epic 4.6)', () => {
  it('sem provider (default) envia via Meta Cloud API, igual ao comportamento de sempre', async () => {
    await runSendBubbles({ phoneNumberId: 'pn-1', accessToken: 'tok-1' }, '595981234567', ['Oi!'], async () => {});
    expect(sendWhatsAppTextMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'Oi!');
    expect(markAsReadAndShowTyping).toHaveBeenCalled();
    expect(sendEvolutionTextMessage).not.toHaveBeenCalled();
  });

  it('provider "evolution" envia via Evolution API, nunca via Meta', async () => {
    await runSendBubbles(
      { provider: 'evolution', evolutionInstanceName: 'inst-1', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'key-1' },
      '595981234567',
      ['Oi!'],
      async () => {}
    );
    expect(sendEvolutionTextMessage).toHaveBeenCalledWith('inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'Oi!');
    expect(showEvolutionTyping).toHaveBeenCalledWith('inst-1', 'https://evo.example.com', 'key-1');
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(markAsReadAndShowTyping).not.toHaveBeenCalled();
  });

  it('múltiplas bolhas via Evolution chamam sendEvolutionTextMessage uma vez por bolha, na ordem', async () => {
    await runSendBubbles(
      { provider: 'evolution', evolutionInstanceName: 'inst-1', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'key-1' },
      '595981234567',
      ['Primeira', 'Segunda'],
      async () => {}
    );
    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(2);
    expect(sendEvolutionTextMessage).toHaveBeenNthCalledWith(1, 'inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'Primeira');
    expect(sendEvolutionTextMessage).toHaveBeenNthCalledWith(2, 'inst-1', 'https://evo.example.com', 'key-1', '595981234567', 'Segunda');
  });
});
