/**
 * Achado ao vivo em produção: mensagem de grupo do WhatsApp (JID termina em
 * "@g.us") virava lead/conversa normal, com o ID numérico do grupo (formato
 * "120363...") como "telefone" — poluía a lista com assunto de grupo sem
 * relação com o negócio, e imagem de grupo nunca baixava (nenhum campo de
 * mídia é populado pra esse tipo de JID), gerando "Imagem indisponível" pra
 * sempre. parseEvolutionWebhookPayload agora descarta mensagem de grupo na
 * origem, antes de virar conversa.
 */
import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from '../webhookParsers';

describe('parseEvolutionWebhookPayload — filtro de grupo (@g.us)', () => {
  it('descarta mensagem de texto vinda de um grupo', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-group-1', remoteJid: '120363228399394676@g.us', fromMe: false },
        pushName: 'Ru Andrade',
        message: { conversation: 'Bom dia pessoal!' },
      },
    });
    expect(parsed).toEqual([]);
  });

  it('descarta mensagem de imagem vinda de um grupo', () => {
    const parsed = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-group-2', remoteJid: '120363393686842333@g.us', fromMe: false },
        pushName: 'Event Planner',
        message: { imageMessage: {} },
      },
    });
    expect(parsed).toEqual([]);
  });

  it('continua processando normalmente mensagem de contato individual (@s.whatsapp.net)', () => {
    const [msg] = parseEvolutionWebhookPayload({
      event: 'messages.upsert',
      instance: 'cliente-abc',
      data: {
        key: { id: 'wamid-1', remoteJid: '595981234567@s.whatsapp.net', fromMe: false },
        pushName: 'Cliente',
        message: { conversation: 'Oi, quero agendar' },
      },
    });
    expect(msg.type).toBe('text');
    expect(msg.from).toBe('595981234567');
  });
});
