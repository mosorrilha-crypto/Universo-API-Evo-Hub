/**
 * TASK-0364 (achado real, 09/09/2026): das 371 conversas do tenant Monique
 * (Evolution API), nenhuma tinha atribuição de anúncio gravada — o parser só
 * lia `msg.referral` no formato da Meta Cloud API, que não existe na
 * Evolution API. O WhatsApp (Baileys) carrega a mesma informação em
 * `contextInfo.externalAdReply` — ver extractEvolutionAdReferral em
 * webhookParsers.ts.
 */
import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from '../webhookParsers';

function evolutionPayload(message: any) {
  return {
    event: 'messages.upsert',
    instance: 'cliente-teste',
    data: {
      key: { id: 'wamid-ad-1', remoteJid: '595981234567@s.whatsapp.net', fromMe: false },
      pushName: 'Cliente',
      message,
    },
  };
}

describe('parseEvolutionWebhookPayload — atribuição de anúncio (TASK-0364)', () => {
  it('captura título e sourceId de contextInfo.externalAdReply em extendedTextMessage', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({
        extendedTextMessage: {
          text: '¡Hola! Quiero más información',
          contextInfo: { externalAdReply: { title: 'Combo Cejas + Labios', sourceId: '12345678901234567' } },
        },
      })
    );
    expect(msg.referral).toEqual({ headline: 'Combo Cejas + Labios', sourceId: '12345678901234567', ctwaClid: undefined });
  });

  it('captura ctwaClid quando o payload traz esse campo também', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({
        extendedTextMessage: {
          text: 'Hola',
          contextInfo: { externalAdReply: { title: 'Promo Unhas', sourceId: '999', ctwaClid: 'clid-real-abc' } },
        },
      })
    );
    expect(msg.referral?.ctwaClid).toBe('clid-real-abc');
  });

  it('captura de imageMessage/videoMessage também, não só extendedTextMessage', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({ imageMessage: { caption: 'oi', contextInfo: { externalAdReply: { title: 'Anúncio Foto' } } } })
    );
    expect(msg.referral?.headline).toBe('Anúncio Foto');
  });

  it('mensagem sem contextInfo/externalAdReply não tem referral (comportamento de sempre, sem regressão)', () => {
    const [msg] = parseEvolutionWebhookPayload(evolutionPayload({ conversation: 'Oi, quero agendar' }));
    expect(msg.referral).toBeUndefined();
  });

  it('externalAdReply presente mas sem nenhum campo útil (título/sourceId/ctwaClid) não vira referral', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({ extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply: {} } } })
    );
    expect(msg.referral).toBeUndefined();
  });

  it('formato inesperado (contextInfo não é objeto) não quebra o parsing — só não captura atribuição', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({ extendedTextMessage: { text: 'oi', contextInfo: 'string-inesperada' } })
    );
    expect(msg.referral).toBeUndefined();
    expect(msg.text).toBe('oi');
  });
});
