import { Router, type RequestHandler } from 'express';
import { listConversations, getConversation, recordOutgoingMessage, clearConversationHistory, deleteConversation, deleteMessage, markGeoRestricted } from '../services/conversationStore';
import { sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage, isGeoRestrictedError } from '../services/metaSend';
import { getAgentStatus, setAgentStatus, type AgentStatus } from '../services/agentStatus';
import { getKnowledgeBase, setKnowledgeBase } from '../services/knowledgeBaseStore';
import { listEscalations, resolveEscalation, deleteEscalation } from '../services/escalationStore';
import { getQuickReplies, setQuickReplies } from '../services/quickRepliesStore';
import { getMediaImage } from '../services/mediaImageStore';
import { setPaymentVerification } from '../services/appointmentStore';
import { LEGACY_DEFAULT_TENANT_ID } from '../services/tenantContext';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

interface ConversationsRouterDeps {
  authenticateToken: RequestHandler;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

/** tenantId do operador autenticado — cai no tenant legado se o JWT (ex: token demo antigo) não trouxer um. */
function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || LEGACY_DEFAULT_TENANT_ID;
}

/**
 * Expõe as conversas reais de WhatsApp (recebidas via webhook) pro frontend
 * usar em vez do mock local (WhatsAppLeadsSim), permite responder de
 * verdade pelo painel (texto e mídia), e controla o status do agente
 * automático (active/paused/restricted — ver server/services/agentStatus.ts).
 */
export function createConversationsRouter({ authenticateToken, metaAccessToken, metaPhoneNumberId, supabaseUrl, supabaseKey }: ConversationsRouterDeps): Router {
  const router = Router();

  // Imagem real recebida de um cliente (ex: comprovante de pagamento) —
  // nunca pública, só acessível autenticado (pode conter dado sensível).
  router.get('/api/media/:messageId', authenticateToken, asyncHandler(async (req, res) => {
    const media = await getMediaImage(supabaseUrl, supabaseKey, req.params.messageId);
    if (!media) return res.status(404).json({ error: 'Imagem não encontrada.' });
    res.setHeader('Content-Type', media.contentType);
    res.send(media.buffer);
  }));

  router.get('/api/conversations', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ conversations: await listConversations(tenantOf(req)) });
  }));

  router.get('/api/conversations/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const conv = await getConversation(tenantOf(req), req.params.phone);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ conversation: conv });
  }));

  router.post('/api/conversations/:phone/send', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Campo "text" é obrigatório.' });
    }
    const tenantId = tenantOf(req);

    try {
      await sendWhatsAppTextMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, text.trim());
      const conv = await recordOutgoingMessage(tenantId, req.params.phone, {
        type: 'text',
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
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
      const mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, base64, mimeType, filename || 'arquivo');
      await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, mimeType, caption);
      const msgType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'file';
      const conv = await recordOutgoingMessage(tenantId, req.params.phone, {
        type: msgType,
        text: msgType === 'audio' ? '🎤 Áudio enviado' : (caption || `📎 ${filename || 'Arquivo enviado'}`),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
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
      const mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, product.exampleImageBase64, mimeType, `${productName}.jpg`);
      await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, mimeType, productName);
      const conv = await recordOutgoingMessage(tenantId, req.params.phone, {
        type: 'image',
        text: `📷 Foto de exemplo: ${productName}`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) await markGeoRestricted(tenantId, req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar foto de exemplo:', err.message);
      res.status(502).json({ error: err.message });
    }
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
    res.json({ escalations: await listEscalations(tenantOf(req)) });
  }));

  router.post('/api/escalations/:id/resolve', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const e = await resolveEscalation(tenantOf(req), req.params.id);
    if (!e) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    res.json({ escalation: e });
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
