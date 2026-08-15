/**
 * Envio da sequência fixa de "1º contato" (blocos texto/imagem/vídeo/arquivo,
 * definidos pelo tenant na Base de Conhecimento, campo
 * `AgentKnowledgeBase.firstContactBlocks`, na ordem do array) — NÃO é gerado
 * pela IA, é conteúdo fixo. Pedido real (Clic Piscinas, 14-15/08/2026):
 * "manda o bloco inteiro de informação + vídeo primeiro, intercalando texto/
 * vídeo/texto na ordem que eu quiser, a negociação começa a partir da
 * PRÓXIMA mensagem do cliente", em vez da pergunta de triagem padrão da IA
 * logo na 1ª mensagem. Quem chama isso (webhooks.ts) é responsável por
 * pular a chamada normal ao agente nesse turno — este arquivo só cuida do
 * envio, em ordem, um bloco de cada vez.
 */
import type { AgentKnowledgeBase, FirstContactBlock } from './knowledgeBaseStore';
import type { MediaSendConfig } from './autoReply';
import { getKnowledgeBaseVideo } from './knowledgeBaseVideoStore';
import { getKnowledgeBaseDocument } from './knowledgeBaseDocumentStore';
import { sendWhatsAppTextMessage, sendWhatsAppMediaMessage, uploadWhatsAppMedia } from './metaSend';
import { sendEvolutionTextMessage, sendEvolutionMediaMessage } from './evolutionSend';
import { recordOutgoingMessage } from './conversationStore';
import { saveMediaImage } from './mediaImageStore';

/** Mesmo esquema de id usado em conversationStore.ts — gerado aqui ANTES do envio pra poder salvar o binário sob o mesmo id (ver saveMediaImage abaixo). */
function newMessageId(): string {
  return `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** true quando há pelo menos um bloco com conteúdo de fato — bloco presente mas vazio (ex: type 'text' sem texto) não deve disparar nada. */
export function hasFirstContactMessage(kb: AgentKnowledgeBase | null | undefined): boolean {
  return !!kb?.firstContactBlocks?.some(blockHasContent);
}

function blockHasContent(block: FirstContactBlock): boolean {
  switch (block.type) {
    case 'text':
      return !!block.text?.trim();
    case 'image':
      return !!block.imageBase64;
    case 'video':
      return !!block.videoId;
    case 'file':
      return !!block.fileId;
    default:
      return false;
  }
}

function nowTimestamp(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function sendBlock(tenantId: string, phone: string, block: FirstContactBlock, mediaConfig: MediaSendConfig): Promise<void> {
  const isEvolution = mediaConfig.provider === 'evolution';

  if (block.type === 'text') {
    const text = block.text?.trim();
    if (!text) return;
    if (isEvolution) {
      await sendEvolutionTextMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, text);
    } else {
      await sendWhatsAppTextMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, text);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'text', text, timestamp: nowTimestamp() }, 'ai');
    console.log(`🤖 [Primeiro Contato] tenant=${tenantId} bloco texto enviado pra ${phone}: "${text.slice(0, 60)}"`);
    return;
  }

  if (block.type === 'image') {
    if (!block.imageBase64) return;
    const mimeType = block.imageMimeType || 'image/jpeg';
    const cleanBase64 = block.imageBase64.replace(/^data:[^;]+;base64,/, '');
    if (isEvolution) {
      await sendEvolutionMediaMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, cleanBase64, mimeType, 'primeiro-contato.jpg');
    } else {
      const buffer = Buffer.from(cleanBase64, 'base64');
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, buffer, mimeType, 'primeiro-contato.jpg');
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'image', text: '📷 Mensagem de primeiro contato', timestamp: nowTimestamp() }, 'ai');
    console.log(`🤖 [Primeiro Contato] tenant=${tenantId} bloco imagem enviado pra ${phone}.`);
    return;
  }

  if (block.type === 'video') {
    if (!block.videoId) return;
    const video = await getKnowledgeBaseVideo(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, tenantId, block.videoId);
    if (!video) {
      console.warn(`⚠️  [Primeiro Contato] tenant=${tenantId} vídeo configurado (${block.videoId}) não encontrado no Storage.`);
      return;
    }
    const mimeType = block.videoMimeType || video.contentType;
    const filename = block.videoFileName || 'primeiro-contato.mp4';
    const caption = block.videoCaption?.trim() || undefined;
    if (isEvolution) {
      await sendEvolutionMediaMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, video.buffer.toString('base64'), mimeType, filename, caption);
    } else {
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, video.buffer, mimeType, filename);
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType, caption);
    }
    // Achado real em produção (15/08/2026, Clic Piscinas): o vídeo abria
    // normalmente no WhatsApp real do lead, mas o painel nunca teve preview
    // de vídeo nenhum — só um card estático "Vídeo enviado". Salva o
    // binário sob o MESMO id da mensagem (mesmo mecanismo já usado pra
    // imagem enviada pelo painel, ver mediaImageStore.ts) pra
    // GET /api/media/:messageId conseguir servir de volta e o painel tocar
    // o vídeo de verdade.
    const messageId = newMessageId();
    await saveMediaImage(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, messageId, video.buffer.toString('base64'), mimeType);
    await recordOutgoingMessage(tenantId, phone, { type: 'file', text: caption ? `🎥 ${caption}` : '🎥 Vídeo de primeiro contato', timestamp: nowTimestamp() }, 'ai', undefined, undefined, messageId);
    console.log(`🤖 [Primeiro Contato] tenant=${tenantId} bloco vídeo (${filename}, ${(video.buffer.length / (1024 * 1024)).toFixed(1)}MB) enviado pra ${phone} via ${isEvolution ? 'Evolution' : 'Meta'}.`);
    return;
  }

  if (block.type === 'file') {
    if (!block.fileId) return;
    const file = await getKnowledgeBaseDocument(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, tenantId, block.fileId);
    if (!file) {
      console.warn(`⚠️  [Primeiro Contato] tenant=${tenantId} arquivo configurado (${block.fileId}) não encontrado no Storage.`);
      return;
    }
    const mimeType = block.fileMimeType || file.contentType;
    const filename = block.fileName || 'catalogo.pdf';
    if (isEvolution) {
      await sendEvolutionMediaMessage(mediaConfig.evolutionInstanceName, mediaConfig.evolutionApiUrl, mediaConfig.evolutionApiKey, phone, file.buffer.toString('base64'), mimeType, filename);
    } else {
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, file.buffer, mimeType, filename);
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType);
    }
    await recordOutgoingMessage(tenantId, phone, { type: 'file', text: `📎 Arquivo de primeiro contato: ${filename}`, timestamp: nowTimestamp() }, 'ai');
    console.log(`🤖 [Primeiro Contato] tenant=${tenantId} bloco arquivo (${filename}) enviado pra ${phone} via ${isEvolution ? 'Evolution' : 'Meta'}.`);
  }
}

/**
 * Manda os blocos em ordem, um de cada vez (aguarda cada envio antes do
 * próximo) — preserva a sequência texto/vídeo/texto/... exatamente como
 * configurada. Achado real em produção (15/08/2026, Clic Piscinas — mensagem
 * de primeiro contato não chegava no WhatsApp real): um bloco que falhasse
 * no meio (ex: vídeo grande demorando/rejeitado pela Evolution API) derrubava
 * a sequência INTEIRA — os blocos seguintes (ex: texto explicando o que fica
 * a cargo do cliente) nunca chegavam a ser enviados, mesmo sem relação
 * nenhuma com o bloco que falhou. Cada bloco agora falha isoladamente: um
 * erro é logado e a sequência continua pro próximo bloco, em vez de abortar
 * tudo.
 */
export async function sendFirstContactMessage(
  tenantId: string,
  phone: string,
  kb: AgentKnowledgeBase,
  mediaConfig: MediaSendConfig
): Promise<void> {
  const blocks = kb.firstContactBlocks || [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!blockHasContent(block)) continue;
    try {
      await sendBlock(tenantId, phone, block, mediaConfig);
    } catch (err: any) {
      console.error(`❌ [Primeiro Contato] tenant=${tenantId} falhou ao enviar o bloco ${i + 1}/${blocks.length} (${block.type}) pra ${phone}: ${err.message} — seguindo pros próximos blocos.`);
    }
  }
}
