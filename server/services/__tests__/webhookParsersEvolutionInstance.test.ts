/**
 * Epic 4.6 (Porta A — Evolution API): o roteamento multi-instância
 * (tenantResolver.resolveTenantByEvolutionInstance) depende de o parser
 * capturar `body.instance` em cada mensagem — sem isso toda mensagem
 * Evolution cairia sempre no tenant legado, mesmo com várias instâncias
 * cadastradas.
 */
import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhookPayload } from '../webhookParsers';

function evolutionPayload(overrides: Partial<any> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'cliente-novo-abc123',
    data: {
      key: { id: 'wamid-1', remoteJid: '595981234567@s.whatsapp.net', fromMe: false },
      pushName: 'Cliente',
      message: { conversation: 'Oi, quero agendar' },
    },
    ...overrides,
  };
}

describe('parseEvolutionWebhookPayload — instanceName (Epic 4.6)', () => {
  it('captura o nome da instância de body.instance em mensagem de texto', () => {
    const [msg] = parseEvolutionWebhookPayload(evolutionPayload());
    expect(msg.instanceName).toBe('cliente-novo-abc123');
    expect(msg.provider).toBe('evolution');
  });

  it('captura a instância também em mensagem de áudio', () => {
    const [msg] = parseEvolutionWebhookPayload(
      evolutionPayload({ data: { key: { id: 'wamid-2', remoteJid: '595981234567@s.whatsapp.net', fromMe: false }, message: { audioMessage: { url: 'x', mediaKey: 'y', mimetype: 'audio/ogg' } } } })
    );
    expect(msg.instanceName).toBe('cliente-novo-abc123');
    expect(msg.type).toBe('audio');
  });

  it('instanceName vem undefined quando o payload não traz body.instance', () => {
    const payload = evolutionPayload();
    delete (payload as any).instance;
    const [msg] = parseEvolutionWebhookPayload(payload);
    expect(msg.instanceName).toBeUndefined();
  });
});
