/**
 * Achado ao vivo em produção: imagem recebida via Evolution API nunca
 * carregava no painel ("Imagem indisponível" pra sempre) — o parser
 * marcava type='image' mas nunca guardava referência nenhuma pra buscar os
 * bytes depois (diferente de evolutionAudio, que já existia). Cobre que o
 * parser agora sinaliza evolutionImage:true pra webhooks.ts saber que
 * precisa baixar via downloadEvolutionMedia (mesmo padrão do áudio).
 */
import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from '../webhookParsers';

describe('parseEvolutionWebhookPayload — evolutionImage', () => {
  it('marca evolutionImage=true pra mensagem de imagem de contato individual', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-img-1', remoteJid: '595991746577@s.whatsapp.net', fromMe: false },
        pushName: 'Dra Lida Melgarejo',
        message: { imageMessage: {} },
      },
    });
    expect(msg.type).toBe('image');
    expect(msg.evolutionImage).toBe(true);
    expect(msg.metaImage).toBeUndefined();
  });

  it('extrai a legenda quando a imagem chega com caption (achado real 28/08/2026)', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-img-2', remoteJid: '595991746577@s.whatsapp.net', fromMe: false },
        pushName: 'Dra Lida Melgarejo',
        message: { imageMessage: { caption: '1ª Corrida Elas em Movimento — 11/10/2026' } },
      },
    });
    expect(msg.type).toBe('image');
    expect(msg.caption).toBe('1ª Corrida Elas em Movimento — 11/10/2026');
  });

  it('não define caption quando a imagem chega sem legenda', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-img-3', remoteJid: '595991746577@s.whatsapp.net', fromMe: false },
        pushName: 'Dra Lida Melgarejo',
        message: { imageMessage: {} },
      },
    });
    expect(msg.caption).toBeUndefined();
  });
});
