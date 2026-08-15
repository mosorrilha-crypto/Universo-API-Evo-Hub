/**
 * Achado real em produção (15/08/2026, tenant Clic Piscinas): o WhatsApp, em
 * rollout progressivo de uma migração de privacidade, pode endereçar uma
 * conversa por um identificador opaco (`@lid`) em vez do JID de telefone
 * tradicional (`@s.whatsapp.net`) — confirmado nos logs reais da nossa
 * instância Evolution API (`92432041537779@lid`). Sem tratar isso, `from`
 * virava esse número opaco, criando uma conversa NOVA duplicada pro mesmo
 * lead real. Bug documentado/ativo na comunidade Baileys (base da Evolution
 * API): https://github.com/WhiskeySockets/Baileys/issues/1718 — o telefone
 * real, quando disponível, vem em `key.remoteJidAlt`.
 */
import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from '../webhookParsers';

describe('parseEvolutionWebhookPayload — fallback de @lid (key.remoteJidAlt)', () => {
  it('usa remoteJidAlt (telefone real) quando remoteJid vem como @lid', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-lid-1', remoteJid: '92432041537779@lid', remoteJidAlt: '556798038466@s.whatsapp.net', fromMe: false },
        pushName: 'Lucas',
        message: { conversation: 'Oii, eu quero comprar uma piscina?' },
      },
    });
    expect(msg.from).toBe('556798038466');
  });

  it('cai pro valor opaco do @lid quando remoteJidAlt não vem no payload (sem regressão)', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-lid-2', remoteJid: '92432041537779@lid', fromMe: false },
        pushName: 'Lucas',
        message: { conversation: 'Oii' },
      },
    });
    expect(msg.from).toBe('92432041537779');
  });

  it('continua usando remoteJid normalmente quando não é @lid, mesmo com remoteJidAlt presente', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-normal-1', remoteJid: '595981234567@s.whatsapp.net', remoteJidAlt: '999999999@s.whatsapp.net', fromMe: false },
        pushName: 'Cliente',
        message: { conversation: 'Oi' },
      },
    });
    expect(msg.from).toBe('595981234567');
  });
});
