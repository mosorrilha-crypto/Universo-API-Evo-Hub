import { Router, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  listConversations,
  getConversation,
  updateMessageText,
  recordOutgoingMessage,
  clearConversationHistory,
  deleteConversation,
  deleteMessage,
  markGeoRestricted,
  forwardMessage,
  reactToMessage,
  getMessageForReply,
  updateConversationState,
  markConversationRead,
} from '../services/conversationStore';
import { addLabel, removeLabel, listAllTenantLabels } from '../services/conversationLabelStore';
import { sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage, sendWhatsAppAudioMessage, isGeoRestrictedError } from '../services/metaSend';
import { sendEvolutionTextMessage, sendEvolutionMediaMessage, showEvolutionTyping, sendEvolutionStatus } from '../services/evolutionSend';
import { resolveCredentialsForTenant } from '../services/tenantResolver';
import { getAgentStatus, setAgentStatus, isAdsOnlyMode, setAdsOnlyMode, getAdTriggerMessages, setAdTriggerMessages, type AgentStatus } from '../services/agentStatus';
import { getKnowledgeBase, setKnowledgeBase, collectReferencedVideoIds, formatKnowledgeBaseForPrompt, resolveProductPriceAmount } from '../services/knowledgeBaseStore';
import { createFinancialTransaction, isDuplicateSourceRefError } from '../services/financialStore';
import { getTenantBusinessHours, setTenantBusinessHours, validateBusinessHours } from '../services/tenantProfileStore';
import { uploadKnowledgeBaseDocument, getKnowledgeBaseDocument, deleteKnowledgeBaseDocument, extractTextFromDocument } from '../services/knowledgeBaseDocumentStore';
import { uploadKnowledgeBaseVideo, getKnowledgeBaseVideo, deleteKnowledgeBaseVideo, ALLOWED_VIDEO_MIME_TYPES, MAX_VIDEO_BYTES, MAX_VIDEO_INPUT_BYTES } from '../services/knowledgeBaseVideoStore';
import { transcodeToWhatsAppVideo } from '../services/videoTranscode';
import { listEscalations, resolveEscalation, deleteEscalation, submitOperatorReply } from '../services/escalationStore';
import { sendOperatorGuidedFollowUp, getCustomerServiceWindowStatus } from '../services/operatorFollowUpService';
import { getDb } from '../services/db';
import { getTenantPromptLayerRow, setTenantPromptLayer, clearTenantPromptLayer } from '../services/tenantPromptLayerStore';
import bcrypt from 'bcrypt';
import { getQuickReplies, setQuickReplies } from '../services/quickRepliesStore';
import { getMediaImage, saveMediaImage } from '../services/mediaImageStore';
import { transcribeAudioWithGemini } from '../services/geminiTranscription';
import { transcodeToWhatsAppVoiceNote } from '../services/audioTranscode';
import { getAppointmentForPhone, setAppointmentForPhone, setPaymentVerification, clearAppointmentForPhone, attachCalendarEventToHold, type TrackedAppointment } from '../services/appointmentStore';
import { checkFreeBusy, createCalendarEvent, cancelCalendarEvent, type CalendarConfig } from '../services/googleCalendar';
import { getNowLocalNaive } from '../services/autoReply';
import { subscribeTenant } from '../services/conversationEvents';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveTenantId, requireRole } from '../middleware/rbac';

const BUSINESS_TIMEZONE = 'America/Asuncion';

interface ConversationsRouterDeps {
  authenticateToken: RequestHandler;
  jwtSecret: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  /** Issue #97 — retomada guiada pelo operador precisa da IA pra redigir a mensagem dentro da janela de 24h. */
  getAi?: () => import('@google/genai').GoogleGenAI | null;
  /** Issue #182 — cadastro manual de agendamento cria um evento real no Google Calendar, mesmo caminho que a ferramenta criar_agendamento da IA usa. */
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
}

/**
 * tenantId de verdade da requisição — por padrão vem do JWT do operador
 * autenticado (achado numa auditoria externa: caía silenciosamente no
 * tenant legado quando o JWT não trazia tenantId, em vez de rejeitar; hoje
 * todo fluxo de emissão de token sempre inclui tenantId, então isso nunca
 * deveria disparar em uso normal, mas se disparar precisa rejeitar). Único
 * jeito de mudar isso é ser saas_admin usando o seletor de tenant do painel
 * — ver resolveTenantId em middleware/rbac.ts pro porquê disso existir
 * (achado real em produção, 15/08/2026: esse seletor era só cosmético e
 * causou uma gravação cross-tenant real).
 */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

/**
 * Expõe as conversas reais de WhatsApp (recebidas via webhook) pro frontend
 * usar em vez do mock local (WhatsAppLeadsSim), permite responder de
 * verdade pelo painel (texto e mídia), e controla o status do agente
 * automático (active/paused/restricted — ver server/services/agentStatus.ts).
 */
export function createConversationsRouter({ authenticateToken, jwtSecret, metaAccessToken, metaPhoneNumberId, evolutionApiUrl, evolutionApiKey, evolutionInstanceName, supabaseUrl, supabaseKey, getAi, googleClientId, googleClientSecret, googleRedirectUri }: ConversationsRouterDeps): Router {
  const router = Router();
  const calendarConfig: CalendarConfig | undefined = googleRedirectUri ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri } : undefined;

  /**
   * Comprovante rejeitado (achado numa auditoria, 16/08/2026): setPaymentVerification
   * só grava o status no banco — nunca libera o evento real no Google
   * Calendar. Uma rejeição deixava o horário ocupado indefinidamente (só o
   * agendamento passar da data liberava esse telefone pra um novo
   * criar_agendamento, ver "existingIsUpcoming" em autoReply.ts), bloqueando
   * outras clientes reais de reservar aquele mesmo horário enquanto isso.
   * Best-effort: se o cancelamento no Calendar falhar, mantém a linha em
   * `appointments` intacta (com o eventId) pra um humano cancelar
   * manualmente depois, em vez de perder a referência de um evento órfão.
   *
   * Issue #289 (18/08/2026): uma reserva rejeitada que AINDA não tinha
   * virado evento real (criar_agendamento não cria mais o evento otimista —
   * só o operador aprovando cria) não tem nada pra cancelar no Calendar,
   * só a linha da reserva mesmo — libera direto.
   */
  async function releaseSlotOnRejectedPayment(tenantId: string, phone: string, appointment: TrackedAppointment): Promise<boolean> {
    if (!appointment.eventId) {
      await clearAppointmentForPhone(tenantId, phone);
      return false;
    }
    if (!calendarConfig) return false;
    try {
      await cancelCalendarEvent(tenantId, calendarConfig, appointment.eventId);
      await clearAppointmentForPhone(tenantId, phone);
      return true;
    } catch (err: any) {
      console.warn(`⚠️  [Pagamento rejeitado] falha ao liberar o horário no Calendar (tenant=${tenantId} phone=${phone}):`, err.message);
      return false;
    }
  }

  /**
   * Avisa o painel em tempo real quando uma conversa muda, no lugar do
   * polling de 8s que existia antes — ver server/services/conversationEvents.ts.
   * EventSource (API nativa do browser pra SSE) não manda header
   * Authorization, então o token vem por query string aqui, verificado com
   * o mesmo segredo/algoritmo de authenticateToken (não dá pra reaproveitar
   * o middleware direto, que só lê do header).
   */
  router.get('/api/conversations/stream', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!token) return res.status(401).end();
    let user: any;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch {
      return res.status(403).end();
    }
    if (!user?.tenantId) return res.status(403).end();
    // Mesma exceção de resolveTenantId (middleware/rbac.ts): só saas_admin
    // pode apontar pra outro tenant, aqui via querystring (EventSource
    // nativo não manda header customizado) — o painel manda isso a partir
    // do tenant selecionado no seletor.
    const requestedTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
    const tenantId = user.role === 'saas_admin' && requestedTenantId ? requestedTenantId : user.tenantId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = subscribeTenant(tenantId, (phone: string) => {
      res.write(`data: ${JSON.stringify({ phone })}\n\n`);
    });

    // Mantém a conexão viva atrás de proxies com idle timeout (ex: Render) —
    // sem isso a conexão cai em silêncio depois de alguns minutos sem tráfego.
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }));

  // Imagem real recebida de um cliente (ex: comprovante de pagamento) —
  // nunca pública, só acessível autenticado (pode conter dado sensível).
  router.get('/api/media/:messageId', authenticateToken, asyncHandler(async (req, res) => {
    const media = await getMediaImage(supabaseUrl, supabaseKey, req.params.messageId);
    if (!media) return res.status(404).json({ error: 'Imagem não encontrada.' });
    res.setHeader('Content-Type', media.contentType);
    res.send(media.buffer);
  }));

  /**
   * Refaz a transcrição de um áudio já recebido — pedido real (19/08/2026):
   * a falha original quase sempre é uma instabilidade passageira do Gemini
   * (timeout de 20s, "high demand"), não falta de crédito, então tentar de
   * novo minutos depois costuma funcionar. O áudio original já fica salvo
   * (mesmo bucket/rota da imagem, ver saveMediaImage em
   * transcriptionQueue.ts) — reusa esses bytes em vez de pedir de novo pro
   * WhatsApp. `updateMessageText` já dispara o SSE de conversas
   * (emitConversationUpdated), então o painel atualiza sozinho sem precisar
   * de nenhum estado extra aqui.
   */
  router.post('/api/conversations/:phone/messages/:messageId/retry-transcription', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { phone, messageId } = req.params;

    const conv = await getConversation(tenantId, phone);
    const message = conv?.messages.find((m) => m.id === messageId);
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (message.type !== 'audio') return res.status(400).json({ error: 'Esta mensagem não é um áudio.' });

    const media = await getMediaImage(supabaseUrl, supabaseKey, messageId);
    if (!media) {
      return res.status(404).json({ error: 'Áudio original não está mais disponível pra reprocessar (não foi salvo ou expirou).' });
    }

    const outcome = await transcribeAudioWithGemini(getAi ? getAi() : null, media.buffer.toString('base64'), media.contentType, {
      leadName: conv?.name,
      customInstructions: formatKnowledgeBaseForPrompt(await getKnowledgeBase(tenantId)),
    });

    await updateMessageText(tenantId, phone, messageId, outcome.result.transcription);

    res.json({ success: outcome.source === 'gemini', source: outcome.source, transcription: outcome.result.transcription });
  }));

  router.get('/api/conversations', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const includeArchived = req.query.archived === 'true';
    res.json({ conversations: await listConversations(tenantOf(req), { includeArchived }) });
  }));

  router.get('/api/conversations/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const conv = await getConversation(tenantOf(req), req.params.phone);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ conversation: conv });
  }));

  // Marca a conversa como lida — chamado quando o operador abre a conversa
  // no painel. Zera unreadCount pra frente (mensagens do lead já recebidas
  // até agora); não afeta mensagens que ainda vão chegar.
  router.post('/api/conversations/:phone/read', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await markConversationRead(tenantOf(req), req.params.phone);
    res.json({ success: true });
  }));

  router.post('/api/conversations/:phone/send', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { text, replyToMessageId } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Campo "text" é obrigatório.' });
    }
    const tenantId = tenantOf(req);

    try {
      const channel = await resolveCredentialsForTenant(
        tenantId,
        { metaAccessToken, metaPhoneNumberId },
        { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
      );

      // Achado real (18/08/2026): "Responder" no painel só marcava
      // replyToMessageId no nosso banco — o cliente nunca via "em resposta
      // a X" no WhatsApp dele de verdade. Só dá pra citar de verdade quando
      // a mensagem alvo tem um id REAL de provedor (wamid da Meta / id do
      // Baileys, gravado como customId em recordIncomingMessage/
      // recordOutgoingMessage) — nunca o id local `wa-<timestamp>-...` que
      // esta mesma rota gerava antes desta correção pra mensagens enviadas
      // sem esse id real. Citar um id inválido faria a Meta rejeitar o
      // envio inteiro, então nesse caso a citação simplesmente não é
      // enviada pra API real (a marcação interna do painel continua igual).
      let replyTarget: Awaited<ReturnType<typeof getMessageForReply>> | undefined;
      if (typeof replyToMessageId === 'string' && replyToMessageId) {
        replyTarget = await getMessageForReply(tenantId, replyToMessageId);
      }
      const hasRealProviderId = !!replyTarget && !replyTarget.id.startsWith('wa-');

      let realMessageId: string | undefined;
      if (channel.provider === 'evolution') {
        realMessageId = await sendEvolutionTextMessage(
          channel.evolutionInstanceName,
          channel.evolutionApiUrl,
          channel.evolutionApiKey,
          req.params.phone,
          text.trim(),
          hasRealProviderId
            ? { id: replyTarget!.id, remoteJid: `${req.params.phone}@s.whatsapp.net`, fromMe: replyTarget!.sender === 'agent', text: replyTarget!.text }
            : undefined
        );
      } else {
        realMessageId = await sendWhatsAppTextMessage(
          channel.metaPhoneNumberId,
          channel.metaAccessToken,
          req.params.phone,
          text.trim(),
          hasRealProviderId ? replyTarget!.id : undefined
        );
      }
      const conv = await recordOutgoingMessage(
        tenantId,
        req.params.phone,
        {
          type: 'text',
          text: text.trim(),
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        'operator',
        typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
        undefined,
        realMessageId
      );
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) await markGeoRestricted(tenantId, req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar mensagem real:', err.message);
      res.status(502).json({ error: err.message });
    }
  }));

  // Envio de arquivo/foto real (upload do dispositivo do operador, via painel)
  router.post('/api/conversations/:phone/send-media', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { base64, mimeType, filename, caption } = req.body || {};
    if (!base64 || !mimeType) {
      return res.status(400).json({ error: 'Campos "base64" e "mimeType" são obrigatórios.' });
    }
    const tenantId = tenantOf(req);

    try {
      let uploadBase64 = base64;
      let uploadMimeType = mimeType as string;
      let uploadFilename = filename || 'arquivo';
      const channel = await resolveCredentialsForTenant(
        tenantId,
        { metaAccessToken, metaPhoneNumberId },
        { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
      );
      const isEvolution = channel.provider === 'evolution';
      if (typeof mimeType === 'string' && mimeType.startsWith('audio/')) {
        const transcoded = await transcodeToWhatsAppVoiceNote(base64, mimeType);
        uploadBase64 = transcoded.base64;
        // mimeType (e filename) do upload/persistência seguem o que a
        // transcodificação retornou.
        uploadMimeType = transcoded.mimeType;
        uploadFilename = uploadMimeType.startsWith('audio/mpeg') ? 'audio.mp3' : 'audio.ogg';

        if (isEvolution) {
          await sendEvolutionMediaMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, req.params.phone, uploadBase64, uploadMimeType, uploadFilename);
        } else {
          const audioBuffer = Buffer.from(uploadBase64, 'base64');
          await sendWhatsAppAudioMessage(channel.metaPhoneNumberId, channel.metaAccessToken, req.params.phone, audioBuffer, uploadMimeType);
        }
      } else {
        const cleanBase64 = uploadBase64.replace(/^data:[^;]+;base64,/, '');
        if (isEvolution) {
          await sendEvolutionMediaMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, req.params.phone, cleanBase64, uploadMimeType, uploadFilename, caption);
        } else {
          const mediaBuffer = Buffer.from(cleanBase64, 'base64');
          const mediaId = await uploadWhatsAppMedia(channel.metaPhoneNumberId, channel.metaAccessToken, mediaBuffer, uploadMimeType, uploadFilename);
          await sendWhatsAppMediaMessage(channel.metaPhoneNumberId, channel.metaAccessToken, req.params.phone, mediaId, uploadMimeType, caption);
        }
      }

      const msgType = uploadMimeType.startsWith('image/') ? 'image' : uploadMimeType.startsWith('audio/') ? 'audio' : 'file';
      // Achado real em produção ("o áudio não fica na conversa"): a Meta
      // recebe o áudio/imagem de verdade, mas nós nunca guardávamos uma
      // cópia — só o texto placeholder ("🎤 Áudio enviado") ficava salvo, e
      // o painel não tinha como tocar de novo depois de recarregar. Gera o
      // id da mensagem ANTES de gravar pra poder salvar a mídia real sob o
      // mesmo id (mesmo bucket/rota já usados pra imagem recebida do
      // cliente, GET /api/media/:messageId).
      const messageId = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const conv = await recordOutgoingMessage(
        tenantId,
        req.params.phone,
        {
          type: msgType,
          text: msgType === 'audio' ? '🎤 Áudio enviado' : (caption || `📎 ${filename || 'Arquivo enviado'}`),
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        'operator',
        undefined,
        undefined,
        messageId
      );
      // Salva a versão JÁ CONVERTIDA (não o webm original) — senão o próprio
      // player de áudio do painel (GET /api/media/:messageId) herdaria o
      // mesmo problema de reprodução que motivou a conversão.
      await saveMediaImage(supabaseUrl, supabaseKey, messageId, uploadBase64, uploadMimeType);
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) await markGeoRestricted(tenantId, req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar mídia real:', err.message);
      res.status(502).json({ error: err.message });
    }
  }));

  // Pro painel saber, antes de abrir o modal, se esse tenant tem canal
  // capaz de postar Status (só Evolution API) — evita deixar o operador
  // preencher tudo pra só descobrir na hora de enviar que não dá.
  router.get('/api/status/available', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const credentials = await resolveCredentialsForTenant(
      tenantOf(req),
      { metaAccessToken, metaPhoneNumberId },
      { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
    );
    res.json({ available: credentials.provider === 'evolution' });
  }));

  // Postar Status/Stories da empresa (pedido real do dono do produto,
  // 12/08/2026: fotos de antes/depois de procedimento já aquecem lead
  // comprovadamente). Só existe pra tenants conectados via Evolution API
  // (Baileys/QR Code) — a Meta Cloud API oficial não tem Status nenhum, então
  // resolveCredentialsForTenant precisa achar provider 'evolution' pra esse
  // tenant, senão não tem como cumprir o pedido.
  router.post('/api/status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { text, imageBase64, videoBase64, caption, backgroundColor } = req.body || {};
    const hasText = typeof text === 'string' && text.trim();
    const hasImage = typeof imageBase64 === 'string' && imageBase64.trim();
    const hasVideo = typeof videoBase64 === 'string' && videoBase64.trim();
    if (!hasText && !hasImage && !hasVideo) {
      return res.status(400).json({ error: 'Informe um texto, uma imagem ou um vídeo pro Status.' });
    }

    const tenantId = tenantOf(req);
    const credentials = await resolveCredentialsForTenant(
      tenantId,
      { metaAccessToken, metaPhoneNumberId },
      { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
    );
    if (credentials.provider !== 'evolution') {
      return res.status(400).json({ error: 'Esse número está conectado pela Meta Cloud API oficial, que não tem suporte a Status — só tenants conectados via Evolution API (QR Code) podem postar.' });
    }

    try {
      if (hasVideo) {
        await sendEvolutionStatus(credentials.evolutionInstanceName, credentials.evolutionApiUrl, credentials.evolutionApiKey, {
          type: 'video',
          content: videoBase64,
          caption: typeof caption === 'string' && caption.trim() ? caption.trim() : undefined,
        });
      } else if (hasImage) {
        await sendEvolutionStatus(credentials.evolutionInstanceName, credentials.evolutionApiUrl, credentials.evolutionApiKey, {
          type: 'image',
          content: imageBase64,
          caption: typeof caption === 'string' && caption.trim() ? caption.trim() : undefined,
        });
      } else {
        await sendEvolutionStatus(credentials.evolutionInstanceName, credentials.evolutionApiUrl, credentials.evolutionApiKey, {
          type: 'text',
          content: text.trim(),
          backgroundColor: typeof backgroundColor === 'string' && backgroundColor.trim() ? backgroundColor.trim() : undefined,
        });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('❌ [Status] Falha ao postar Status via Evolution API:', err.message);
      res.status(502).json({ error: err.message });
    }
  }));

  // Limpa o histórico de mensagens de um número (ex: número de teste), mas
  // mantém o contato/lead — útil pra testes não ficarem contaminados pela
  // memória de conversas anteriores (o agente usa o histórico como contexto).
  router.delete('/api/conversations/:phone/history', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const conv = await clearConversationHistory(tenantOf(req), req.params.phone);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true, conversation: conv });
  }));

  // Exclui o contato inteiro (não só o histórico) — usado quando o operador
  // apaga a conversa da lista. Diferente de /history acima, que só limpa as
  // mensagens e mantém o contato.
  router.delete('/api/conversations/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const existed = await deleteConversation(tenantOf(req), req.params.phone);
    if (!existed) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true });
  }));

  router.delete('/api/conversations/:phone/messages/:messageId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const existed = await deleteMessage(tenantOf(req), req.params.phone, req.params.messageId);
    if (!existed) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    res.json({ success: true });
  }));

  // Encaminha uma mensagem existente pra outro contato (sempre do mesmo
  // tenant — forwardMessage nunca resolve messageId/toPhone fora do
  // tenantId do JWT). Metadado só do painel, não reflete no WhatsApp real.
  router.post('/api/conversations/:phone/messages/:messageId/forward', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { toPhone } = req.body || {};
    if (!toPhone || typeof toPhone !== 'string' || !toPhone.trim()) {
      return res.status(400).json({ error: 'Campo "toPhone" é obrigatório.' });
    }
    const conv = await forwardMessage(tenantOf(req), req.params.messageId, toPhone.trim());
    res.json({ success: true, conversation: conv });
  }));

  // Reage a uma mensagem com um emoji — upsert por ator (reagir de novo
  // troca a reação anterior do mesmo operador, não acumula).
  router.post('/api/conversations/:phone/messages/:messageId/react', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { emoji } = req.body || {};
    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'Campo "emoji" é obrigatório.' });
    }
    const reactions = await reactToMessage(tenantOf(req), req.params.messageId, emoji, 'agent');
    res.json({ success: true, reactions });
  }));


  // Etiquetas livres por conversa (tipo WhatsApp Business) — características/
  // sinais que se acumulam, complementares ao estágio único do CRM.
  router.post('/api/conversations/:phone/labels', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { label } = req.body || {};
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'Campo "label" é obrigatório.' });
    }
    const labels = await addLabel(tenantOf(req), req.params.phone, label);
    if (labels === undefined) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true, labels });
  }));

  router.delete('/api/conversations/:phone/labels/:label', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const labels = await removeLabel(tenantOf(req), req.params.phone, req.params.label);
    if (labels === undefined) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true, labels });
  }));

  // Todas as etiquetas distintas já usadas no tenant — sugestões de
  // autocomplete no painel (pra não gerar "Interesada en pestañas" e
  // "Interessada em Pestañas" como duas etiquetas por erro de digitação).
  router.get('/api/conversation-labels', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ labels: await listAllTenantLabels(tenantOf(req)) });
  }));

  // Organização da lista de conversas — arquivar, fixar no topo, silenciar
  // notificações, marcar como não lida manualmente, identificar o lead
  // trocando/adicionando o nome do contato, bloquear a IA pra um lead
  // específico (menu ⋮ de cada conversa no painel — muitos leads reais
  // chegam só com o número de telefone como "nome" porque a Meta só manda
  // o nome de perfil quando o cliente definiu um; e um lead claramente não
  // qualificado/insistente não deveria continuar recebendo resposta
  // automática). Uma rota só pra tudo, em vez de vários endpoints quase
  // idênticos — cada campo do body é opcional, só atualiza o que veio.
  router.patch('/api/conversations/:phone/state', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { archived, pinned, muted, unread, name, aiBlocked, adLead } = req.body || {};
    const patch: { archived?: boolean; pinned?: boolean; muted?: boolean; unread?: boolean; name?: string; aiBlocked?: boolean; adLead?: true } = {};
    if (typeof archived === 'boolean') patch.archived = archived;
    if (typeof pinned === 'boolean') patch.pinned = pinned;
    if (typeof muted === 'boolean') patch.muted = muted;
    if (typeof unread === 'boolean') patch.unread = unread;
    if (typeof aiBlocked === 'boolean') patch.aiBlocked = aiBlocked;
    if (adLead === true) patch.adLead = true;
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Campo "name" não pode ser vazio.' });
      patch.name = trimmed;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um campo: archived, pinned, muted, unread, name, aiBlocked ou adLead.' });
    }
    const conv = await updateConversationState(tenantOf(req), req.params.phone, patch);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true, conversation: conv });
  }));

  // Envia a foto de exemplo cadastrada na Base de Conhecimento pro serviço
  // indicado — pro operador (ou futuramente o agente) responder com a foto
  // certa quando o lead perguntar sobre aquele procedimento específico.
  router.post('/api/conversations/:phone/send-example-photo', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { productName } = req.body || {};
    if (!productName) return res.status(400).json({ error: 'Campo "productName" é obrigatório.' });
    const tenantId = tenantOf(req);

    const kb = await getKnowledgeBase(tenantId);
    const product = kb?.products?.find((p) => p.name === productName);
    if (!product?.exampleImageBase64) {
      return res.status(404).json({ error: 'Esse serviço não tem foto de exemplo cadastrada na Base de Conhecimento.' });
    }

    try {
      const mimeType = product.exampleImageMimeType || 'image/jpeg';
      const channel = await resolveCredentialsForTenant(
        tenantId,
        { metaAccessToken, metaPhoneNumberId },
        { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
      );
      const cleanImageBase64 = product.exampleImageBase64.replace(/^data:[^;]+;base64,/, '');
      if (channel.provider === 'evolution') {
        await sendEvolutionMediaMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, req.params.phone, cleanImageBase64, mimeType, `${productName}.jpg`, productName);
      } else {
        const exampleImageBuffer = Buffer.from(cleanImageBase64, 'base64');
        const mediaId = await uploadWhatsAppMedia(channel.metaPhoneNumberId, channel.metaAccessToken, exampleImageBuffer, mimeType, `${productName}.jpg`);
        await sendWhatsAppMediaMessage(channel.metaPhoneNumberId, channel.metaAccessToken, req.params.phone, mediaId, mimeType, productName);
      }

      // Mesmo padrão do /send-media (ver comentário lá): gera o id ANTES de
      // gravar pra poder salvar a imagem real sob o mesmo id — sem isso, o
      // painel tenta buscar a mídia por messageId e nunca encontra nada
      // (achado ao extender o carregamento de imagem real pras mensagens QUE
      // NÓS enviamos, não só as do lead).
      const messageId = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const conv = await recordOutgoingMessage(
        tenantId,
        req.params.phone,
        {
          type: 'image',
          text: `📷 Foto de exemplo: ${productName}`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        'operator',
        undefined,
        undefined,
        messageId
      );
      await saveMediaImage(supabaseUrl, supabaseKey, messageId, product.exampleImageBase64, mimeType);
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) await markGeoRestricted(tenantId, req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar foto de exemplo:', err.message);
      res.status(502).json({ error: err.message });
    }
  }));

  // Mesma ideia do /send-example-photo acima, pro vídeo de exemplo — o
  // vídeo não fica inline na base (ver knowledgeBaseVideoStore.ts), então
  // busca o binário do Storage antes de mandar. Não salva uma cópia sob o
  // messageId (diferente da foto): o histórico do painel mostra só o texto
  // placeholder — o vídeo real chega no WhatsApp do cliente, que é o canal
  // que importa aqui; tocar de novo dentro do painel fica pra uma
  // iteração futura se vier a ser pedido.
  router.post('/api/conversations/:phone/send-example-video', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { productName } = req.body || {};
    if (!productName) return res.status(400).json({ error: 'Campo "productName" é obrigatório.' });
    const tenantId = tenantOf(req);

    const kb = await getKnowledgeBase(tenantId);
    const product = kb?.products?.find((p) => p.name === productName);
    if (!product?.exampleVideoId) {
      return res.status(404).json({ error: 'Esse serviço não tem vídeo de exemplo cadastrado na Base de Conhecimento.' });
    }
    const video = await getKnowledgeBaseVideo(supabaseUrl, supabaseKey, tenantId, product.exampleVideoId);
    if (!video) {
      return res.status(404).json({ error: 'O vídeo cadastrado não foi encontrado no Storage — tente subir de novo na Base de Conhecimento.' });
    }

    try {
      const mimeType = product.exampleVideoMimeType || video.contentType;
      const filename = product.exampleVideoFileName || `${productName}.mp4`;
      const channel = await resolveCredentialsForTenant(
        tenantId,
        { metaAccessToken, metaPhoneNumberId },
        { evolutionApiUrl, evolutionApiKey, evolutionInstanceName }
      );
      if (channel.provider === 'evolution') {
        await sendEvolutionMediaMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, req.params.phone, video.buffer.toString('base64'), mimeType, filename, productName);
      } else {
        const mediaId = await uploadWhatsAppMedia(channel.metaPhoneNumberId, channel.metaAccessToken, video.buffer, mimeType, filename);
        await sendWhatsAppMediaMessage(channel.metaPhoneNumberId, channel.metaAccessToken, req.params.phone, mediaId, mimeType, productName);
      }

      const conv = await recordOutgoingMessage(
        tenantId,
        req.params.phone,
        {
          type: 'file',
          text: `🎥 Vídeo de exemplo: ${productName}`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        'operator'
      );
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) await markGeoRestricted(tenantId, req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar vídeo de exemplo:', err.message);
      res.status(502).json({ error: err.message });
    }
  }));

  // Issue #82, item 3: o fluxo de verificação de pagamento (setPaymentVerification
  // abaixo) já existia e funcionava, mas o agendamento/status de pagamento
  // nunca chegava ao frontend pra alguém ver e agir — não existia nenhuma
  // rota GET expondo isso. Achado real em produção: um agendamento com sinal
  // pago ficou preso em "pending_verification" por não ter botão nenhum no
  // produto pra confirmar.
  router.get('/api/conversations/:phone/appointment', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const appointment = await getAppointmentForPhone(tenantOf(req), req.params.phone);
    res.json({ appointment: appointment || null });
  }));

  // Issue #182 — agendamento fechado fora da IA (WhatsApp pessoal, telefone,
  // presencial) até aqui era invisível pro sistema inteiro: nenhuma linha em
  // appointments, nenhum lembrete automático, e o comprovante de pagamento
  // do cliente caía num "buraco" (webhooks.ts só marca pending_verification
  // quando já existe um agendamento ativo pra esse telefone). Cria um evento
  // real no Google Calendar (mesmo caminho de criar_agendamento em
  // autoReply.ts) + a linha em appointments com source='manual', pra entrar
  // no mesmo lembrete automático — mas sem disparar Purchase pro Meta CAPI
  // (decisão do dono do produto: sem origem de anúncio rastreável).
  router.post('/api/conversations/:phone/manual-appointment', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!calendarConfig) {
      return res.status(503).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const tenantId = tenantOf(req);
    const phone = req.params.phone;
    const { serviceName, startIso, endIso, notes, paymentReceived } = req.body || {};
    if (!serviceName?.trim() || !startIso || !endIso) {
      return res.status(400).json({ error: 'Campos "serviceName", "startIso" e "endIso" são obrigatórios.' });
    }

    // Mesmo bug real de produção corrigido em autoReply.ts/criar_agendamento
    // (PR #203): um agendamento antigo, já passado, nunca some da tabela
    // sozinho (só cancelar_agendamento limpa, e só no fluxo de <24h) — um
    // cliente recorrente voltando por um serviço novo não pode ser
    // bloqueado por um agendamento que já aconteceu há dias.
    const existing = await getAppointmentForPhone(tenantId, phone);
    const { naive: nowNaiveForCheck } = getNowLocalNaive(BUSINESS_TIMEZONE);
    const existingIsUpcoming = existing && Date.parse(`${existing.endIso}Z`) > Date.parse(`${nowNaiveForCheck}Z`);
    if (existingIsUpcoming) {
      return res.status(409).json({ error: `Este contato já tem um agendamento ativo ("${existing!.summary}" em ${existing!.startIso}).` });
    }

    let disponivel: boolean;
    try {
      disponivel = await checkFreeBusy(tenantId, calendarConfig, startIso, endIso, BUSINESS_TIMEZONE);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao verificar disponibilidade na agenda: ${err.message}` });
    }
    if (!disponivel) {
      return res.status(409).json({ error: 'Esse horário já está ocupado na agenda.' });
    }

    // Observação livre do operador (ex: "cliente pediu produto X junto",
    // "confirmar endereço antes") — some junto da tag fixa que já marca o
    // evento como agendamento manual, não substitui ela.
    const description = typeof notes === 'string' && notes.trim()
      ? `Agendado manualmente pelo operador no painel.\n\n${notes.trim()}`
      : 'Agendado manualmente pelo operador no painel.';

    let eventId: string;
    try {
      eventId = await createCalendarEvent(tenantId, calendarConfig, serviceName.trim(), description, startIso, endIso, BUSINESS_TIMEZONE);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao criar o evento na agenda: ${err.message}` });
    }

    // resetPaymentState: true — o caso "já ativo" já foi recusado acima, então
    // isto é sempre um ciclo de pagamento novo (nunca deve herdar payment_status
    // de um agendamento antigo, existente ou não), mesmo raciocínio do PR #203.
    await setAppointmentForPhone(tenantId, phone, { eventId, summary: serviceName.trim(), startIso, endIso, source: 'manual' }, { resetPaymentState: true });

    // Agendamento fechado fora do WhatsApp (ex: presencial, telefone) já pode
    // vir com o comprovante conferido na hora do cadastro — sem isso não
    // havia como marcar isso no painel, e o agendamento ficava indistinguível
    // de um sem pagamento nenhum ainda verificado.
    if (paymentReceived === true) {
      const verified = await setPaymentVerification(tenantId, phone, 'verified', req.user!.id);
      if (verified) await recordFinancialTransactionForVerifiedPayment(tenantId, phone, verified);
    }

    const appointment = await getAppointmentForPhone(tenantId, phone);
    res.status(201).json({ appointment });
  }));

  /**
   * Achado real em produção (19/08/2026, pedido direto do dono do produto):
   * o fluxo real de venda (WhatsApp → agendamento → comprovante aprovado) e
   * o Financeiro eram dois sistemas paralelos — confirmar um pagamento
   * (por qualquer um dos 3 caminhos abaixo) só atualizava o agendamento,
   * nunca virava um registro financeiro. A única forma de uma venda real
   * aparecer no Financeiro era o operador digitar tudo de novo
   * manualmente. Cria a transação automaticamente quando o comprovante é
   * aprovado, usando o preço real da Base de Conhecimento pelo nome do
   * serviço (nunca inventa valor — 0 quando o nome não bate com nenhum
   * produto do catálogo, ex: agendamento manual com descrição livre).
   *
   * Chamada pelos 3 pontos que hoje marcam um pagamento como 'verified':
   * o card de Escalonamentos (POST /api/escalations/:id/resolve-payment —
   * o caminho REAL, o único com botão no painel desde 12/08/2026, ver
   * comentário acima de verify-payment abaixo), o cadastro manual de
   * agendamento com "pagamento já recebido" marcado
   * (POST /api/conversations/:phone/manual-appointment), e o próprio
   * verify-payment abaixo (sem botão no painel hoje, mas mantido como
   * caminho de API — não removido por precaução).
   *
   * `sourceRef` (o eventId do Calendar, único por definição) faz a
   * constraint única (tenant_id, source_ref) da migration 0037 proteger
   * contra duplicar numa reentrega/retry — o erro de duplicidade é
   * engolido em silêncio (isDuplicateSourceRefError); qualquer outro erro
   * só loga, nunca derruba a resposta da ação principal que o operador
   * pediu (o registro financeiro é um efeito colateral, não pode bloquear
   * o fluxo real de pagamento).
   */
  async function recordFinancialTransactionForVerifiedPayment(
    tenantId: string,
    phone: string,
    appointment: TrackedAppointment
  ): Promise<void> {
    if (!appointment.eventId) return; // sem evento real, sem referência estável pra deduplicar
    try {
      const [kb, conversation] = await Promise.all([
        getKnowledgeBase(tenantId),
        getConversation(tenantId, phone),
      ]);
      const normalized = appointment.summary.trim().toLowerCase();
      const product = kb?.products?.find((p) => p.name.trim().toLowerCase() === normalized);
      const amount = product ? resolveProductPriceAmount(product) : 0;
      await createFinancialTransaction(tenantId, {
        id: crypto.randomUUID(),
        leadId: phone,
        leadName: conversation?.name || phone,
        leadPhone: phone,
        productName: appointment.summary,
        amount,
        paymentMethod: 'Transferência Bancária',
        status: 'pago',
        date: new Date().toISOString(),
        operatorName: 'Automático (comprovante aprovado)',
        channel: appointment.source === 'manual' ? 'Agendamento manual' : 'WhatsApp',
        sourceRef: `apt:${appointment.eventId}`,
      });
    } catch (err) {
      if (isDuplicateSourceRefError(err)) return; // já registrado antes (retry/reentrega) — nada a fazer
      console.warn(`⚠️  [Financeiro] Falha ao registrar transação automática pro agendamento verificado (tenant=${tenantId}, phone=${phone}):`, (err as Error)?.message || err);
    }
  }

  // Etapa 8 (fluxo de verificação de pagamento) — marca o comprovante que
  // chegou (webhooks.ts já grava pending_verification automaticamente
  // quando uma imagem chega com agendamento ativo sem comprovante ainda)
  // como verificado (bate com o valor/seña combinado) ou rejeitado. A IA
  // nunca chama isso — só o operador humano decide, e o agente
  // (autoReply.ts, runAgendamentoTools) lê o resultado no próximo turno pra
  // saber se já pode confirmar o turno pro cliente.
  //
  // Achado real (pedido do dono do produto, 12/08/2026): o botão
  // "Confirmar"/"Rejeitar" que chamava ESTE endpoint direto da conversa
  // (WhatsAppLeadsSim.tsx) foi removido — virava um segundo lugar
  // desconectado do escalonamento que webhooks.ts já cria automaticamente
  // pro mesmo comprovante, e confirmar por ali não avisava o cliente do
  // motivo. Unificado no card de Escalonamentos (kind: 'payment_proof' —
  // EscalationsPanel.tsx, App.tsx handleResolvePaymentEscalation), que
  // chama POST /api/escalations/:id/resolve-payment abaixo, não este.
  // Hoje NENHUM botão do painel chama este endpoint diretamente — mantido
  // como caminho de API (coberto por testes, ver
  // conversationsVerifyPayment*.test.ts) por precaução, não removido.
  router.post('/api/conversations/:phone/verify-payment', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status } = req.body || {};
    if (status !== 'verified' && status !== 'rejected') {
      return res.status(400).json({ error: 'Campo "status" precisa ser "verified" ou "rejected".' });
    }
    const operatorId = req.user?.id;
    if (!operatorId) return res.status(401).json({ error: 'Sessão sem operador identificado.' });

    const tenantId = tenantOf(req);
    const phone = req.params.phone;
    const before = await getAppointmentForPhone(tenantId, phone);
    if (!before) return res.status(404).json({ error: 'Nenhum agendamento ativo encontrado pra este contato.' });

    // Issue #289 (18/08/2026): uma reserva feita pela IA fica SEM evento
    // real no Calendar até aqui — o operador aprovando o comprovante é o
    // gatilho real pra criar o evento de verdade, nunca antes. Reconsulta
    // disponibilidade agora porque o horário pode ter sido ocupado por
    // outra coisa nesse meio-tempo (ex: um agendamento manual do próprio
    // operador, ou outra reserva que virou evento primeiro).
    if (status === 'verified' && !before.eventId) {
      if (!calendarConfig) {
        return res.status(503).json({ error: 'Google Calendar não configurado neste servidor — não é possível criar o evento real.' });
      }
      let disponivel: boolean;
      try {
        disponivel = await checkFreeBusy(tenantId, calendarConfig, before.startIso, before.endIso, BUSINESS_TIMEZONE);
      } catch (err: any) {
        return res.status(502).json({ error: `Falha ao verificar disponibilidade na agenda: ${err.message}` });
      }
      if (!disponivel) {
        return res.status(409).json({ error: `O horário reservado (${before.startIso}) ficou ocupado enquanto o pagamento era analisado — combine um novo horário com o cliente antes de aprovar.` });
      }
      let eventId: string;
      try {
        eventId = await createCalendarEvent(tenantId, calendarConfig, before.summary, 'Confirmado pelo agente após aprovação do comprovante de pagamento.', before.startIso, before.endIso, BUSINESS_TIMEZONE);
      } catch (err: any) {
        return res.status(502).json({ error: `Falha ao criar o evento na agenda: ${err.message}` });
      }
      await attachCalendarEventToHold(tenantId, phone, eventId);
    }

    const updated = await setPaymentVerification(tenantId, phone, status, operatorId);
    if (!updated) return res.status(404).json({ error: 'Nenhum agendamento ativo encontrado pra este contato.' });
    const calendarReleased = status === 'rejected' ? await releaseSlotOnRejectedPayment(tenantId, phone, updated) : false;
    if (status === 'verified') await recordFinancialTransactionForVerifiedPayment(tenantId, phone, updated);
    res.json({ success: true, appointment: updated, calendarReleased });
  }));

  // Status do agente automático (Epic 1.3 — pausar/restringir horário) +
  // modo "somente anúncios" (pedido real, 14/08/2026 — ver agentStatus.ts).
  router.get('/api/agent-status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const [status, adsOnly, adTriggerMessages] = await Promise.all([getAgentStatus(tenantId), isAdsOnlyMode(tenantId), getAdTriggerMessages(tenantId)]);
    res.json({ status, adsOnly, adTriggerMessages });
  }));

  router.post('/api/agent-status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status, adsOnly, adTriggerMessages } = req.body || {};
    const tenantId = tenantOf(req);
    try {
      if (status !== undefined) await setAgentStatus(tenantId, status as AgentStatus);
      if (typeof adsOnly === 'boolean') await setAdsOnlyMode(tenantId, adsOnly);
      if (Array.isArray(adTriggerMessages)) {
        if (!adTriggerMessages.every((m) => typeof m === 'string')) {
          return res.status(400).json({ error: 'adTriggerMessages precisa ser uma lista de textos.' });
        }
        await setAdTriggerMessages(tenantId, adTriggerMessages.map((m) => m.trim()).filter(Boolean));
      }
      const [newStatus, newAdsOnly, newAdTriggerMessages] = await Promise.all([getAgentStatus(tenantId), isAdsOnlyMode(tenantId), getAdTriggerMessages(tenantId)]);
      res.json({ status: newStatus, adsOnly: newAdsOnly, adTriggerMessages: newAdTriggerMessages });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  // Base de conhecimento real do agente (objetivo, regras, preços, FAQ) —
  // usada como contexto nos prompts de resposta automática.
  router.get('/api/knowledge-base', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ knowledgeBase: await getKnowledgeBase(tenantOf(req)) });
  }));

  router.post('/api/knowledge-base', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { knowledgeBase } = req.body || {};
    if (!knowledgeBase || typeof knowledgeBase !== 'object') {
      return res.status(400).json({ error: 'Campo "knowledgeBase" é obrigatório.' });
    }
    const tenantId = tenantOf(req);
    // Issue #261 — só agora (save real, bem-sucedido) é seguro apagar vídeo
    // do Storage: qualquer videoId que estava referenciado na KB anterior e
    // deixou de aparecer na nova é, de fato, lixo (produto/bloco removido ou
    // vídeo trocado por outro) — nunca uma troca que ainda não foi salva.
    const previousVideoIds = collectReferencedVideoIds(await getKnowledgeBase(tenantId));
    await setKnowledgeBase(tenantId, knowledgeBase);
    const currentVideoIds = collectReferencedVideoIds(knowledgeBase);
    const orphanedVideoIds = [...previousVideoIds].filter((id) => !currentVideoIds.has(id));
    await Promise.all(orphanedVideoIds.map((videoId) => deleteKnowledgeBaseVideo(supabaseUrl, supabaseKey, tenantId, videoId)));
    res.json({ success: true });
  }));

  // Camada 1 (regras universais) por tenant (18/08/2026) — leitura sempre
  // mostra o texto EFETIVO em vigor pra este tenant (a cópia própria se
  // existir, senão a Camada 1 global herdada), pra o admin nunca duplicar
  // ou entrar em conflito com uma regra que já está coberta ali. Edição
  // exige a senha do próprio admin de novo (não é a senha de login válida
  // pra sempre — só confirma que é a mesma pessoa autenticada tentando
  // mudar uma regra que afeta TODO o comportamento de segurança do agente
  // deste tenant), e cria uma cópia independente que nunca mais herda
  // mudança futura da Camada 1 global (decisão do dono do produto).
  router.get('/api/tenant-prompt-layer', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await getTenantPromptLayerRow(tenantOf(req)));
  }));

  router.put('/api/tenant-prompt-layer', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { content, currentPassword } = req.body || {};
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Campo "content" é obrigatório.' });
    }
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Confirme sua senha atual pra salvar esta mudança.' });
    }
    const { data: operator, error } = await getDb().from('operators').select('password_hash').eq('id', req.user!.id).maybeSingle();
    if (error || !operator) return res.status(401).json({ error: 'Sessão inválida — faça login de novo.' });
    const validPassword = await bcrypt.compare(currentPassword, operator.password_hash as string);
    if (!validPassword) return res.status(401).json({ error: 'Senha incorreta.' });

    await setTenantPromptLayer(tenantOf(req), content, req.user!.id);
    res.json(await getTenantPromptLayerRow(tenantOf(req)));
  }));

  // "Restaurar padrão" — apaga a cópia própria, volta a herdar a Camada 1
  // global (inclusive mudanças futuras) a partir de agora.
  router.delete('/api/tenant-prompt-layer', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    await clearTenantPromptLayer(tenantOf(req));
    res.json(await getTenantPromptLayerRow(tenantOf(req)));
  }));

  // Horário de funcionamento real do tenant (tabela `tenants`, não a base de
  // conhecimento) — até aqui só existia via SQL direto; o agendamento
  // automático (autoReply.ts/googleCalendar.ts) já dependia disso pra nunca
  // oferecer horário fora do expediente, mas o operador não tinha como ver
  // nem editar. Mesmo padrão de autenticação/tenant-escopo das rotas de
  // knowledge-base acima.
  router.get('/api/business-hours', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ businessHours: await getTenantBusinessHours(tenantOf(req)) });
  }));

  router.post('/api/business-hours', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { businessHours } = req.body || {};
    if (!validateBusinessHours(businessHours)) {
      return res.status(400).json({ error: 'Campo "businessHours" inválido — cada dia precisa de open/close em formato "HH:mm", com close depois de open.' });
    }
    await setTenantBusinessHours(tenantOf(req), businessHours);
    res.json({ success: true });
  }));

  // Dados básicos (id/nome) do tenant do usuário autenticado — até aqui não
  // existia rota nenhuma pra isso, e o badge de "empresa ativa" no
  // cabeçalho (Header.tsx, `activeTenant.name`) vinha só de um mock local
  // hardcoded no frontend (INITIAL_TENANTS, um único registro fictício da
  // Monique) sem nenhuma ligação com o tenant real logado. Achado real em
  // produção: um operador da Clic Piscinas logado via a tela inteira
  // mostrando "Monique Sorrilha Beauty Studio" no cabeçalho, mesmo com os
  // dados (conversas, CRM etc) todos corretos por baixo, porque essas rotas
  // sempre resolveram o tenant pelo JWT — só o badge visual dependia do
  // mock. Mesmo padrão de autenticação/tenant-escopo das rotas acima, sem
  // exigir nenhuma role (qualquer operador pode ver o nome do próprio tenant).
  router.get('/api/tenant', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    // currency/locale entraram aqui (19/08/2026) pro Financeiro conseguir
    // formatar valores na moeda real do tenant (PYG por padrão) em vez de
    // R$/pt-BR fixo — antes esses campos existiam na tabela `tenants` desde
    // sempre mas nunca chegavam ao frontend por nenhuma rota que qualquer
    // operador comum pudesse chamar (só /api/admin/tenants, restrita a
    // saas_admin, devolvia isso).
    const { data, error } = await getDb().from('tenants').select('id, name, currency, locale').eq('id', tenantOf(req)).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Tenant não encontrado.' });
    res.json({ tenant: data });
  }));

  const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // mesmo limite já anunciado no painel (15MB)
  // Achado real: nada limitava quantos documentos ou quantos MB um tenant
  // podia acumular no bucket compartilhado "app-data" — um tenant sozinho
  // subindo muitos arquivos grandes consumiria o espaço de todo mundo, sem
  // aviso nenhum. Esses dois tetos por tenant existem só pra isso.
  const MAX_DOCUMENTS_PER_TENANT = 30;
  const MAX_TOTAL_BYTES_PER_TENANT = 200 * 1024 * 1024; // 200MB

  // Upload real de documento anexado à base de conhecimento — até aqui a
  // aba "Documentos Anexados" era só um registro visual fictício (achado
  // real: 2 "documentos" hardcoded no preset da Monique que nunca
  // existiram de verdade, ninguém conseguia abrir). Extrai texto quando dá
  // (PDF/TXT/CSV/JSON/MD, ver knowledgeBaseDocumentStore.ts) pra o agente
  // usar como contexto real (formatKnowledgeBaseForPrompt), com teto de
  // tamanho pra nunca inflar o prompt sem limite.
  router.post('/api/knowledge-base/documents', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { fileName, mimeType, base64 } = req.body || {};
    if (!fileName?.trim() || !base64) {
      return res.status(400).json({ error: 'Campos "fileName" e "base64" são obrigatórios.' });
    }
    const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return res.status(400).json({ error: `Arquivo maior que ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB.` });
    }

    const kb = (await getKnowledgeBase(tenantId)) || {};
    const existingDocs = kb.documents || [];
    if (existingDocs.length >= MAX_DOCUMENTS_PER_TENANT) {
      return res.status(400).json({ error: `Limite de ${MAX_DOCUMENTS_PER_TENANT} documentos atingido. Apague algum documento antigo antes de enviar um novo.` });
    }
    const existingTotalBytes = existingDocs.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
    if (existingTotalBytes + buffer.length > MAX_TOTAL_BYTES_PER_TENANT) {
      const remainingMb = Math.max(0, (MAX_TOTAL_BYTES_PER_TENANT - existingTotalBytes) / (1024 * 1024)).toFixed(1);
      return res.status(400).json({ error: `Limite de ${MAX_TOTAL_BYTES_PER_TENANT / (1024 * 1024)}MB no total atingido (restam ${remainingMb}MB). Apague algum documento antigo antes de enviar um novo.` });
    }

    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedMimeType = mimeType || 'application/octet-stream';
    await uploadKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantId, docId, buffer, resolvedMimeType);
    const extractedText = await extractTextFromDocument(buffer, resolvedMimeType, fileName);

    const newDoc = {
      id: docId,
      fileName: String(fileName).trim(),
      fileSize: `${(buffer.length / (1024 * 1024)).toFixed(1)} MB`,
      sizeBytes: buffer.length,
      mimeType: resolvedMimeType,
      uploadDate: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      status: 'Processado' as const,
      extractedText,
    };
    await setKnowledgeBase(tenantId, { ...kb, documents: [...existingDocs, newDoc] });
    res.json({ document: newDoc });
  }));

  // Baixa/visualiza o arquivo real — nunca público (pode conter dado
  // sensível do negócio), mesmo padrão autenticado de GET /api/media/:messageId.
  router.get('/api/knowledge-base/documents/:docId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const doc = await getKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantOf(req), req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
    res.setHeader('Content-Type', doc.contentType);
    res.send(doc.buffer);
  }));

  router.delete('/api/knowledge-base/documents/:docId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const docId = req.params.docId;
    await deleteKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantId, docId);
    const kb = (await getKnowledgeBase(tenantId)) || {};
    await setKnowledgeBase(tenantId, { ...kb, documents: (kb.documents || []).filter((d) => d.id !== docId) });
    res.json({ success: true });
  }));

  // Upload real de vídeo de exemplo de produto/serviço (pedido real do dono
  // do produto: agente/operador mandarem vídeo, não só foto). Diferente do
  // upload de documento acima: não recebe nem grava productName aqui — só
  // sobe o binário e devolve a referência (videoId), pra funcionar mesmo
  // pra um produto ainda não salvo no servidor (ver knowledgeBaseVideoStore.ts).
  // Quem associa a referência a um produto é o cliente (AgentKnowledgeBase.tsx),
  // no mesmo formData local que já guarda exampleImageBase64 — só persiste
  // de verdade quando a base inteira é salva (POST /api/knowledge-base acima).
  router.post('/api/knowledge-base/videos', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { fileName, mimeType, base64 } = req.body || {};
    if (!fileName?.trim() || !base64 || !mimeType) {
      return res.status(400).json({ error: 'Campos "fileName", "mimeType" e "base64" são obrigatórios.' });
    }
    let resolvedMimeType = String(mimeType).split(';')[0].trim();
    if (!resolvedMimeType.startsWith('video/')) {
      return res.status(400).json({ error: `Arquivo não é um vídeo (${resolvedMimeType}).` });
    }
    let buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > MAX_VIDEO_INPUT_BYTES) {
      return res.status(400).json({ error: `Vídeo original maior que ${MAX_VIDEO_INPUT_BYTES / (1024 * 1024)}MB — comprima antes de enviar.` });
    }

    // Formato que a Meta não aceita direto (ex: .MOV do iPhone, mimeType
    // "video/quicktime") — converte pra MP4 (H.264/AAC) via ffmpeg antes de
    // seguir, mesmo padrão de audioTranscode.ts pra nota de voz. Pedido real
    // do dono do produto: não exigir que o operador converta na mão.
    if (!ALLOWED_VIDEO_MIME_TYPES.has(resolvedMimeType)) {
      try {
        const transcoded = await transcodeToWhatsAppVideo(buffer, resolvedMimeType);
        buffer = transcoded.buffer;
        resolvedMimeType = transcoded.mimeType;
      } catch (err: any) {
        console.error('❌ [KB Vídeo] Falha ao converter vídeo pro formato aceito pela Meta:', err.message);
        return res.status(400).json({ error: `Não foi possível converter esse vídeo pro formato aceito pelo WhatsApp: ${err.message}` });
      }
    }

    if (buffer.length > MAX_VIDEO_BYTES) {
      return res.status(400).json({ error: `Vídeo maior que ${MAX_VIDEO_BYTES / (1024 * 1024)}MB (limite da Meta pra mensagem de vídeo) mesmo depois de convertido.` });
    }

    const videoId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await uploadKnowledgeBaseVideo(supabaseUrl, supabaseKey, tenantId, videoId, buffer, resolvedMimeType);

    // Issue #261 — NÃO apaga o vídeo anterior aqui. Isso era feito no
    // momento do upload (recebendo oldVideoId), mas a referência nova só é
    // persistida de fato quando "Salvar Regras no Agente" salva a KB
    // inteira (POST /api/knowledge-base abaixo) — se o operador trocasse o
    // vídeo e não salvasse depois (fechou a aba, caiu a conexão), o antigo
    // já tinha sido apagado do Storage, deixando a KB salva com uma
    // referência órfã. A limpeza do vídeo antigo agora acontece só depois
    // do save real, comparando o que deixou de ser referenciado.
    res.json({
      videoId,
      mimeType: resolvedMimeType,
      fileName: String(fileName).trim(),
      sizeBytes: buffer.length,
    });
  }));

  // Baixa/visualiza o vídeo real — nunca público (autenticado + escopado
  // por tenant já pela própria chave de Storage), mesmo padrão de
  // GET /api/knowledge-base/documents/:docId acima.
  router.get('/api/knowledge-base/videos/:videoId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const video = await getKnowledgeBaseVideo(supabaseUrl, supabaseKey, tenantOf(req), req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });
    res.setHeader('Content-Type', video.contentType);
    res.send(video.buffer);
  }));

  // Upload de arquivo (ex: catálogo em PDF) pra um bloco tipo "file" da
  // Mensagem Inicial de Primeiro Contato (firstContactBlocks) — mesmo
  // padrão desacoplado do vídeo acima (upload só grava o binário e devolve
  // um fileId; quem associa a um bloco é o formData local no cliente,
  // AgentKnowledgeBase.tsx). Reaproveita o mesmo storage/binário de
  // knowledgeBaseDocumentStore.ts (bucket "app-data", prefixo kb-docs/),
  // mas de propósito NÃO usa a rota POST /api/knowledge-base/documents
  // acima: aquela persiste direto em kb.documents (lista "Documentos
  // Anexados" lida pela IA como contexto — ver formatKnowledgeBaseForPrompt)
  // e roda extração de texto; um catálogo de primeiro contato é só pra
  // MANDAR pro cliente, nunca deve virar contexto de prompt nem contar no
  // teto de MAX_DOCUMENTS_PER_TENANT daquela lista.
  router.post('/api/knowledge-base/first-contact-file', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { fileName, mimeType, base64, oldFileId } = req.body || {};
    if (!fileName?.trim() || !base64) {
      return res.status(400).json({ error: 'Campos "fileName" e "base64" são obrigatórios.' });
    }
    const resolvedMimeType = mimeType || 'application/octet-stream';
    const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return res.status(400).json({ error: `Arquivo maior que ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB.` });
    }

    const fileId = `fc-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await uploadKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantId, fileId, buffer, resolvedMimeType);

    // Substituindo o arquivo anterior do mesmo bloco — apaga o antigo do
    // Storage pra não acumular lixo a cada troca (melhor esforço, mesmo
    // padrão do vídeo acima).
    if (typeof oldFileId === 'string' && oldFileId.trim()) {
      await deleteKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantId, oldFileId.trim());
    }

    res.json({
      fileId,
      mimeType: resolvedMimeType,
      fileName: String(fileName).trim(),
      sizeBytes: buffer.length,
    });
  }));

  // Baixa/visualiza o arquivo de primeiro contato — mesmo padrão autenticado
  // de GET /api/knowledge-base/documents/:docId e /videos/:videoId acima.
  router.get('/api/knowledge-base/first-contact-file/:fileId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const file = await getKnowledgeBaseDocument(supabaseUrl, supabaseKey, tenantOf(req), req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.setHeader('Content-Type', file.contentType);
    res.send(file.buffer);
  }));

  // Escalonamentos pra atendimento humano — "isso precisa de você"
  // (respostas que a IA não conseguiu gerar, bloqueios de envio, e qualquer
  // menção a pagamento/transferência, que nunca deve ser confirmada sozinha
  // pelo agente). Paraguai aparece primeiro (preferência de negócio atual).
  router.get('/api/escalations', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const escalations = await listEscalations(tenantId);
    // Issue #97 — timer de janela de 24h no card, pro operador saber se a
    // resposta dele (própria ou via orientação pra IA) sai como texto livre
    // agora ou precisa esperar o template de reengajamento primeiro. Só
    // calcula pros pendentes (resolvidos não precisam mais disso).
    const withWindow = await Promise.all(
      escalations.map(async (e) => {
        if (e.resolved) return e;
        const window = await getCustomerServiceWindowStatus(tenantId, e.phone);
        return { ...e, withinServiceWindow: window.withinWindow, serviceWindowExpiresAt: window.windowExpiresAt };
      })
    );
    res.json({ escalations: withWindow });
  }));

  router.post('/api/escalations/:id/resolve', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const e = await resolveEscalation(tenantOf(req), req.params.id);
    if (!e) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    res.json({ escalation: e });
  }));

  // Issue #97 — operador deixa uma orientação em vez de assumir a conversa
  // pessoalmente; a IA retoma o atendimento com base nela (texto livre se
  // ainda dentro da janela de 24h da Meta, template de reengajamento se não).
  router.post('/api/escalations/:id/operator-reply', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const reply: string = (req.body?.reply || '').trim();
    if (!reply) return res.status(400).json({ error: 'Campo "reply" é obrigatório.' });

    const escalation = await submitOperatorReply(tenantId, req.params.id, reply);
    if (!escalation) return res.status(404).json({ error: 'Escalonamento não encontrado.' });

    const { data: tenant } = await getDb().from('tenants').select('name').eq('id', tenantId).maybeSingle();
    const outcome = await sendOperatorGuidedFollowUp(tenantId, escalation, {
      ai: getAi?.() ?? null,
      metaAccessToken,
      metaPhoneNumberId,
      tenantName: tenant?.name || 'nosso time',
    });
    res.json({ escalation, outcome });
  }));

  // Unifica a verificação de pagamento dentro do próprio card de
  // escalonamento (pedido real do dono do produto, 12/08/2026): antes disso
  // existiam dois lugares desconectados pro mesmo caso — o banner
  // Confirmar/Rejeitar dentro da conversa (verify-payment acima) e o
  // escalonamento gerado automaticamente pra esse mesmo comprovante
  // (kind: 'payment_proof', ver webhooks.ts). Confirmar/rejeitar E orientar
  // a IA (se rejeitado, por que) agora é uma ação só. Sem "reply": só marca
  // o pagamento e resolve o card, igual o fluxo antigo. Com "reply": além
  // de marcar o pagamento, reusa o mesmo pipeline do operator-reply acima
  // (issue #97) pra já avisar o cliente com o motivo, texto livre se dentro
  // da janela de 24h ou template de reengajamento se não.
  router.post('/api/escalations/:id/resolve-payment', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const operatorId = req.user?.id;
    if (!operatorId) return res.status(401).json({ error: 'Sessão sem operador identificado.' });

    const { phone, status, reply } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Campo "phone" é obrigatório.' });
    if (status !== 'verified' && status !== 'rejected') {
      return res.status(400).json({ error: 'Campo "status" precisa ser "verified" ou "rejected".' });
    }

    const appointment = await setPaymentVerification(tenantId, phone, status, operatorId);
    if (!appointment) return res.status(404).json({ error: 'Nenhum agendamento ativo encontrado pra este contato.' });
    const calendarReleased = status === 'rejected' ? await releaseSlotOnRejectedPayment(tenantId, phone, appointment) : false;
    // Mesmo registro automático do Financeiro do verify-payment acima —
    // esse card de escalonamento é só outro caminho pra aprovar o mesmo
    // comprovante (issue real, 12/08/2026: existiam dois lugares
    // desconectados pra confirmar o mesmo pagamento). Se o evento real ainda
    // não existe no Calendar nesse ponto (não roda a criação como
    // verify-payment acima), a função só não registra nada — sem evento
    // não há `sourceRef` estável pra deduplicar.
    if (status === 'verified') await recordFinancialTransactionForVerifiedPayment(tenantId, phone, appointment);

    const trimmedReply: string = (reply || '').trim();
    if (!trimmedReply) {
      const escalation = await resolveEscalation(tenantId, req.params.id);
      if (!escalation) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
      return res.json({ appointment, escalation, outcome: null, calendarReleased });
    }

    const escalation = await submitOperatorReply(tenantId, req.params.id, trimmedReply);
    if (!escalation) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    const { data: tenant } = await getDb().from('tenants').select('name').eq('id', tenantId).maybeSingle();
    const outcome = await sendOperatorGuidedFollowUp(tenantId, escalation, {
      ai: getAi?.() ?? null,
      metaAccessToken,
      metaPhoneNumberId,
      tenantName: tenant?.name || 'nosso time',
    });
    res.json({ appointment, escalation, outcome, calendarReleased });
  }));

  router.delete('/api/escalations/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const deleted = await deleteEscalation(tenantOf(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    res.json({ success: true });
  }));

  // Respostas rápidas configuráveis (lista única, compartilhada pela equipe)
  router.get('/api/quick-replies', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ quickReplies: await getQuickReplies(tenantOf(req)) });
  }));

  router.post('/api/quick-replies', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { quickReplies } = req.body || {};
    if (!Array.isArray(quickReplies)) return res.status(400).json({ error: 'Campo "quickReplies" deve ser uma lista.' });
    await setQuickReplies(tenantOf(req), quickReplies);
    res.json({ success: true });
  }));

  return router;
}
