import { Router, type RequestHandler } from 'express';
import { listConversations, getConversation, recordOutgoingMessage } from '../services/conversationStore';
import { sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage } from '../services/metaSend';
import { getAgentStatus, setAgentStatus, type AgentStatus } from '../services/agentStatus';
import { getKnowledgeBase, setKnowledgeBase } from '../services/knowledgeBaseStore';

interface ConversationsRouterDeps {
  authenticateToken: RequestHandler;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

/**
 * Expõe as conversas reais de WhatsApp (recebidas via webhook) pro frontend
 * usar em vez do mock local (WhatsAppLeadsSim), permite responder de
 * verdade pelo painel (texto e mídia), e controla o status do agente
 * automático (active/paused/restricted — ver server/services/agentStatus.ts).
 */
export function createConversationsRouter({ authenticateToken, metaAccessToken, metaPhoneNumberId }: ConversationsRouterDeps): Router {
  const router = Router();

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
      const conv = recordOutgoingMessage(req.params.phone, {
        type: mimeType.startsWith('image/') ? 'image' : 'file',
        text: caption || `📎 ${filename || 'Arquivo enviado'}`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      console.error('❌ [Conversas] Falha ao enviar mídia real:', err.message);
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

  return router;
}
