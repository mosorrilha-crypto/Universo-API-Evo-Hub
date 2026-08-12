import { Router, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import {
  listConversations,
  getConversation,
  recordOutgoingMessage,
  clearConversationHistory,
  deleteConversation,
  deleteMessage,
  markGeoRestricted,
  forwardMessage,
  reactToMessage,
  editMessage,
  updateConversationState,
  markConversationRead,
} from '../services/conversationStore';
import { addLabel, removeLabel, listAllTenantLabels } from '../services/conversationLabelStore';
import { sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage, sendWhatsAppAudioMessage, isGeoRestrictedError } from '../services/metaSend';
import { sendEvolutionTextMessage, sendEvolutionMediaMessage, showEvolutionTyping } from '../services/evolutionSend';
import { resolveCredentialsForTenant } from '../services/tenantResolver';
import { getAgentStatus, setAgentStatus, type AgentStatus } from '../services/agentStatus';
import { getKnowledgeBase, setKnowledgeBase } from '../services/knowledgeBaseStore';
import { listEscalations, resolveEscalation, deleteEscalation, submitOperatorReply } from '../services/escalationStore';
import { sendOperatorGuidedFollowUp, getCustomerServiceWindowStatus } from '../services/operatorFollowUpService';
import { getDb } from '../services/db';
import { getQuickReplies, setQuickReplies } from '../services/quickRepliesStore';
import { getMediaImage, saveMediaImage } from '../services/mediaImageStore';
import { transcodeToWhatsAppVoiceNote } from '../services/audioTranscode';
import { getAppointmentForPhone, setAppointmentForPhone, setPaymentVerification } from '../services/appointmentStore';
import { checkFreeBusy, createCalendarEvent, type CalendarConfig } from '../services/googleCalendar';
import { subscribeTenant } from '../services/conversationEvents';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

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
 * tenantId do operador autenticado. Achado numa auditoria externa: caía
 * silenciosamente no tenant legado (dados reais da Monique) quando o JWT não
 * trazia tenantId, em vez de rejeitar — mesmo padrão de risco que o
 * roteamento de webhook por phone_number_id já corrigiu (Bloco 2.B, revisão
 * de segurança 06/08/2026: "nunca gravar/ler em tenant nenhum quando não dá
 * pra provar de quem é"). Hoje todo fluxo de emissão de token (login real e
 * demo, server/routes/auth.ts) sempre inclui tenantId, então isso nunca
 * deveria disparar em uso normal — mas se disparar, precisa rejeitar (todas
 * as rotas deste arquivo passam por asyncHandler, então o throw vira 500 via
 * o middleware de erro global, nunca um vazamento silencioso pro tenant legado).
 */
function tenantOf(req: AuthenticatedRequest): string {
  if (!req.user?.tenantId) {
    throw new Error('Sessão autenticada sem tenantId — recusado (nunca cair no tenant legado por segurança).');
  }
  return req.user.tenantId;
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
  // Anexa as credenciais compartilhadas ao objeto router para uso nos handlers
  (router as any).evolutionApiUrl = evolutionApiUrl;
  (router as any).evolutionApiKey = evolutionApiKey;
  (router as any).evolutionInstanceName = evolutionInstanceName;

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
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(403).end();

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
      // Isolando Evolution por enquanto para garantir que a Meta funcione
      await sendWhatsAppTextMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, text.trim());
      const conv = await recordOutgoingMessage(
        tenantId,
        req.params.phone,
        {
          type: 'text',
          text: text.trim(),
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        'operator',
        typeof replyToMessageId === 'string' ? replyToMessageId : undefined
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
      let mediaId: string;
      if (typeof mimeType === 'string' && mimeType.startsWith('audio/')) {
        const transcoded = await transcodeToWhatsAppVoiceNote(base64, mimeType);
        uploadBase64 = transcoded.base64;
        // mimeType (e filename) do upload/persistência seguem o que a
        // transcodificação retornou — sendWhatsAppAudioMessage escolhe o
        // filename certo internamente a partir do mimeType.
        uploadMimeType = transcoded.mimeType;

        const audioBuffer = Buffer.from(uploadBase64, 'base64');
        mediaId = await sendWhatsAppAudioMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, audioBuffer, uploadMimeType);
      } else {
        const mediaBuffer = Buffer.from(uploadBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
        mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, mediaBuffer, uploadMimeType, uploadFilename);
        await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, uploadMimeType, caption);
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

  // Edita o texto de uma mensagem já enviada — só mensagem do agente/
  // operador (sender='agent'); editar mensagem do lead seria falsificar o
  // que o cliente disse de verdade.
  router.patch('/api/conversations/:phone/messages/:messageId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Campo "text" é obrigatório.' });
    }
    const result = await editMessage(tenantOf(req), req.params.messageId, text.trim());
    if (result.ok === false) {
      if (result.reason === 'not_found') return res.status(404).json({ error: 'Mensagem não encontrada.' });
      return res.status(403).json({ error: 'Só é possível editar mensagens enviadas pelo agente/operador.' });
    }
    const conv = await getConversation(tenantOf(req), req.params.phone);
    res.json({ success: true, conversation: conv });
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
    const { archived, pinned, muted, unread, name, aiBlocked } = req.body || {};
    const patch: { archived?: boolean; pinned?: boolean; muted?: boolean; unread?: boolean; name?: string; aiBlocked?: boolean } = {};
    if (typeof archived === 'boolean') patch.archived = archived;
    if (typeof pinned === 'boolean') patch.pinned = pinned;
    if (typeof muted === 'boolean') patch.muted = muted;
    if (typeof unread === 'boolean') patch.unread = unread;
    if (typeof aiBlocked === 'boolean') patch.aiBlocked = aiBlocked;
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Campo "name" não pode ser vazio.' });
      patch.name = trimmed;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um campo: archived, pinned, muted, unread, name ou aiBlocked.' });
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
      // Isolando Evolution: forçando Meta
      const exampleImageBuffer = Buffer.from(product.exampleImageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, exampleImageBuffer, mimeType, `${productName}.jpg`);
      await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, mimeType, productName);
      
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
    const { serviceName, startIso, endIso } = req.body || {};
    if (!serviceName?.trim() || !startIso || !endIso) {
      return res.status(400).json({ error: 'Campos "serviceName", "startIso" e "endIso" são obrigatórios.' });
    }

    const existing = await getAppointmentForPhone(tenantId, phone);
    if (existing) {
      return res.status(409).json({ error: `Este contato já tem um agendamento ativo ("${existing.summary}" em ${existing.startIso}).` });
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

    let eventId: string;
    try {
      eventId = await createCalendarEvent(tenantId, calendarConfig, serviceName.trim(), 'Agendado manualmente pelo operador no painel.', startIso, endIso, BUSINESS_TIMEZONE);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao criar o evento na agenda: ${err.message}` });
    }

    await setAppointmentForPhone(tenantId, phone, { eventId, summary: serviceName.trim(), startIso, endIso, source: 'manual' });
    const appointment = await getAppointmentForPhone(tenantId, phone);
    res.status(201).json({ appointment });
  }));

  // Etapa 8 (fluxo de verificação de pagamento) — o operador marca aqui o
  // comprovante que chegou (webhooks.ts já grava pending_verification
  // automaticamente quando uma imagem chega com agendamento ativo sem
  // comprovante ainda) como verificado (bate com o valor/seña combinado) ou
  // rejeitado. A IA nunca chama isso — só o operador humano decide, e o
  // agente (autoReply.ts, runAgendamentoTools) lê o resultado no próximo
  // turno pra saber se já pode confirmar o turno pro cliente.
  router.post('/api/conversations/:phone/verify-payment', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status } = req.body || {};
    if (status !== 'verified' && status !== 'rejected') {
      return res.status(400).json({ error: 'Campo "status" precisa ser "verified" ou "rejected".' });
    }
    const operatorId = req.user?.id;
    if (!operatorId) return res.status(401).json({ error: 'Sessão sem operador identificado.' });

    const tenantId = tenantOf(req);
    const updated = await setPaymentVerification(tenantId, req.params.phone, status, operatorId);
    if (!updated) return res.status(404).json({ error: 'Nenhum agendamento ativo encontrado pra este contato.' });
    res.json({ success: true, appointment: updated });
  }));

  // Status do agente automático (Epic 1.3 — pausar/restringir horário)
  router.get('/api/agent-status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ status: await getAgentStatus(tenantOf(req)) });
  }));

  router.post('/api/agent-status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status } = req.body || {};
    const tenantId = tenantOf(req);
    try {
      await setAgentStatus(tenantId, status as AgentStatus);
      res.json({ status: await getAgentStatus(tenantId) });
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
    await setKnowledgeBase(tenantOf(req), knowledgeBase);
    res.json({ success: true });
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
