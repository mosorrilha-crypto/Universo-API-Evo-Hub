/**
 * Envio do bloco fixo de "1º contato" (texto/imagem/vídeo definidos pelo
 * tenant na Base de Conhecimento, campo `AgentKnowledgeBase.firstContactMessage`)
 * — NÃO é gerado pela IA, é conteúdo fixo. Pedido real (Clic Piscinas,
 * 14/08/2026): "manda o bloco inteiro de informação + vídeo primeiro, a
 * negociação começa a partir da PRÓXIMA mensagem do cliente", em vez da
 * pergunta de triagem padrão da IA logo na 1ª mensagem. Quem chama isso
 * (webhooks.ts) é responsável por pular a chamada normal ao agente nesse
 * turno — este arquivo só cuida do envio.
 */
import type { AgentKnowledgeBase } from './knowledgeBaseStore';
import type { MediaSendConfig } from './autoReply';
import { getKnowledgeBaseVideo } from './knowledgeBaseVideoStore';
import { sendWhatsAppTextMessage, sendWhatsAppMediaMessage, uploadWhatsAppMedia } from './metaSend';
import { sendEvolutionTextMessage, sendEvolutionMediaMessage } from './evolutionSend';
import { recordOutgoingMessage } from './conversationStore';

/** true quando há algo de fato configurado pra mandar (texto, imagem ou vídeo) — campo presente mas totalmente vazio não deve disparar nada. */
export function hasFirstContactMessage(kb: AgentKnowledgeBase | null | undefined): boolean {
  const fc = kb?.firstContactMessage;
  return !!(fc && (fc.text?.trim() || fc.imageBase64 || fc.videoId));
}

function nowTimestamp(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function sendFirstContactMessage(
  tenantId: string,
  phone: string,
  kb: AgentKnowledgeBase,
  mediaConfig: MediaSendConfig
): Promise<void> {
  const fc = kb.firstContactMessage;
  if (!fc) return;
  const isEvolution = mediaConfig.provider === 'evolution';

  const text = fc.text?.trim();
  if (text) {
    if (isEvolution) {
      await sendEvolutionTextMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, text);
    } else {
      await sendWhatsAppTextMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, text);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'text', text, timestamp: nowTimestamp() }, 'ai');
  }

  if (fc.imageBase64) {
    const mimeType = fc.imageMimeType || 'image/jpeg';
    const cleanBase64 = fc.imageBase64.replace(/^data:[^;]+;base64,/, '');
    if (isEvolution) {
      await sendEvolutionMediaMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, cleanBase64, mimeType, 'primeiro-contato.jpg');
    } else {
      const buffer = Buffer.from(cleanBase64, 'base64');
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, buffer, mimeType, 'primeiro-contato.jpg');
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'image', text: '📷 Mensagem de primeiro contato', timestamp: nowTimestamp() }, 'ai');
  }

  if (fc.videoId) {
    const video = await getKnowledgeBaseVideo(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, tenantId, fc.videoId);
    if (!video) {
      console.warn(`⚠️  [Primeiro Contato] tenant=${tenantId} vídeo configurado (${fc.videoId}) não encontrado no Storage.`);
      return;
    }
    const mimeType = fc.videoMimeType || video.contentType;
    const filename = fc.videoFileName || 'primeiro-contato.mp4';
    if (isEvolution) {
      await sendEvolutionMediaMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, video.buffer.toString('base64'), mimeType, filename);
    } else {
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, video.buffer, mimeType, filename);
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'file', text: '🎥 Vídeo de primeiro contato', timestamp: nowTimestamp() }, 'ai');
  }
}
