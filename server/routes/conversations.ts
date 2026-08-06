import { Router, type RequestHandler } from 'express';
import { listConversations, getConversation, recordOutgoingMessage, clearConversationHistory, deleteConversation, deleteMessage, markGeoRestricted } from '../services/conversationStore';
import { sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage, isGeoRestrictedError } from '../services/metaSend';
import { getAgentStatus, setAgentStatus, type AgentStatus } from '../services/agentStatus';
import { getKnowledgeBase, setKnowledgeBase } from '../services/knowledgeBaseStore';
import { listEscalations, resolveEscalation, deleteEscalation } from '../services/escalationStore';
import { getQuickReplies, setQuickReplies } from '../services/quickRepliesStore';
import { getMediaImage } from '../services/mediaImageStore';

interface ConversationsRouterDeps {
  authenticateToken: RequestHandler;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
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
  router.get('/api/media/:messageId', authenticateToken, async (req, res) => {
    const media = await getMediaImage(supabaseUrl, supabaseKey, req.params.messageId);
    if (!media) return res.status(404).json({ error: 'Imagem não encontrada.' });
    res.setHeader('Content-Type', media.contentType);
    res.send(media.buffer);
  });

  router.get('/api/conversations', authenticateToken, (req, res) => {
    res.json({ conversations: listConversations() });
  });

  router.get('/api/conversations/:phone', authenticateToken, (req, res) => {
    const conv = getConversation(req.params.phone);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ conversation: conv });
  });

  router.post('/api/conversations/:phone/send', authenticateToken, async (req, res) => {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Campo "text" é obrigatório.' });
    }

    try {
      await sendWhatsAppTextMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, text.trim());
      const conv = recordOutgoingMessage(req.params.phone, {
        type: 'text',
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) markGeoRestricted(req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar mensagem real:', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Envio de arquivo/foto real (upload do dispositivo do operador, via painel)
  router.post('/api/conversations/:phone/send-media', authenticateToken, async (req, res) => {
    const { base64, mimeType, filename, caption } = req.body || {};
    if (!base64 || !mimeType) {
      return res.status(400).json({ error: 'Campos "base64" e "mimeType" são obrigatórios.' });
    }

    try {
      const mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, base64, mimeType, filename || 'arquivo');
      await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, mimeType, caption);
      const msgType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'file';
      const conv = recordOutgoingMessage(req.params.phone, {
        type: msgType,
        text: msgType === 'audio' ? '🎤 Áudio enviado' : (caption || `📎 ${filename || 'Arquivo enviado'}`),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) markGeoRestricted(req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar mídia real:', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Limpa o histórico de mensagens de um número (ex: número de teste), mas
  // mantém o contato/lead — útil pra testes não ficarem contaminados pela
  // memória de conversas anteriores (o agente usa o histórico como contexto).
  router.delete('/api/conversations/:phone/history', authenticateToken, (req, res) => {
    const conv = clearConversationHistory(req.params.phone);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true, conversation: conv });
  });

  // Exclui o contato inteiro (não só o histórico) — usado quando o operador
  // apaga a conversa da lista. Diferente de /history acima, que só limpa as
  // mensagens e mantém o contato.
  router.delete('/api/conversations/:phone', authenticateToken, (req, res) => {
    const existed = deleteConversation(req.params.phone);
    if (!existed) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true });
  });

  router.delete('/api/conversations/:phone/messages/:messageId', authenticateToken, (req, res) => {
    const existed = deleteMessage(req.params.phone, req.params.messageId);
    if (!existed) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    res.json({ success: true });
  });

  // Envia a foto de exemplo cadastrada na Base de Conhecimento pro serviço
  // indicado — pro operador (ou futuramente o agente) responder com a foto
  // certa quando o lead perguntar sobre aquele procedimento específico.
  router.post('/api/conversations/:phone/send-example-photo', authenticateToken, async (req, res) => {
    const { productName } = req.body || {};
    if (!productName) return res.status(400).json({ error: 'Campo "productName" é obrigatório.' });

    const kb = getKnowledgeBase();
    const product = kb?.products?.find((p) => p.name === productName);
    if (!product?.exampleImageBase64) {
      return res.status(404).json({ error: 'Esse serviço não tem foto de exemplo cadastrada na Base de Conhecimento.' });
    }

    try {
      const mimeType = product.exampleImageMimeType || 'image/jpeg';
      const mediaId = await uploadWhatsAppMedia(metaPhoneNumberId, metaAccessToken, product.exampleImageBase64, mimeType, `${productName}.jpg`);
      await sendWhatsAppMediaMessage(metaPhoneNumberId, metaAccessToken, req.params.phone, mediaId, mimeType, productName);
      const conv = recordOutgoingMessage(req.params.phone, {
        type: 'image',
        text: `📷 Foto de exemplo: ${productName}`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      if (isGeoRestrictedError(err)) markGeoRestricted(req.params.phone, err.message);
      console.error('❌ [Conversas] Falha ao enviar foto de exemplo:', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // Status do agente automático (Epic 1.3 — pausar/restringir horário)
  router.get('/api/agent-status', authenticateToken, (req, res) => {
    res.json({ status: getAgentStatus() });
  });

  router.post('/api/agent-status', authenticateToken, (req, res) => {
    const { status } = req.body || {};
    try {
      setAgentStatus(status as AgentStatus);
      res.json({ status: getAgentStatus() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Base de conhecimento real do agente (objetivo, regras, preços, FAQ) —
  // usada como contexto nos prompts de resposta automática.
  router.get('/api/knowledge-base', authenticateToken, (req, res) => {
    res.json({ knowledgeBase: getKnowledgeBase() });
  });

  router.post('/api/knowledge-base', authenticateToken, async (req, res) => {
    const { knowledgeBase } = req.body || {};
    if (!knowledgeBase || typeof knowledgeBase !== 'object') {
      return res.status(400).json({ error: 'Campo "knowledgeBase" é obrigatório.' });
    }
    await setKnowledgeBase(knowledgeBase);
    res.json({ success: true });
  });

  // Escalonamentos pra atendimento humano — "isso precisa de você"
  // (respostas que a IA não conseguiu gerar, bloqueios de envio, e qualquer
  // menção a pagamento/transferência, que nunca deve ser confirmada sozinha
  // pelo agente). Paraguai aparece primeiro (preferência de negócio atual).
  router.get('/api/escalations', authenticateToken, (req, res) => {
    res.json({ escalations: listEscalations() });
  });

  router.post('/api/escalations/:id/resolve', authenticateToken, (req, res) => {
    const e = resolveEscalation(req.params.id);
    if (!e) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    res.json({ escalation: e });
  });

  router.delete('/api/escalations/:id', authenticateToken, (req, res) => {
    const deleted = deleteEscalation(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Escalonamento não encontrado.' });
    res.json({ success: true });
  });

  // Respostas rápidas configuráveis (lista única, compartilhada pela equipe)
  router.get('/api/quick-replies', authenticateToken, (req, res) => {
    res.json({ quickReplies: getQuickReplies() });
  });

  router.post('/api/quick-replies', authenticateToken, async (req, res) => {
    const { quickReplies } = req.body || {};
    if (!Array.isArray(quickReplies)) return res.status(400).json({ error: 'Campo "quickReplies" deve ser uma lista.' });
    await setQuickReplies(quickReplies);
    res.json({ success: true });
  });

  return router;
}
