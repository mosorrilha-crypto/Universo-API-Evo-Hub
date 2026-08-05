import { Router, type RequestHandler } from 'express';
import { listConversations, getConversation, recordOutgoingMessage } from '../services/conversationStore';
import { sendWhatsAppTextMessage } from '../services/metaSend';

interface ConversationsRouterDeps {
  authenticateToken: RequestHandler;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

/**
 * Expõe as conversas reais de WhatsApp (recebidas via webhook) pro frontend
 * usar em vez do mock local (WhatsAppLeadsSim), e permite responder de
 * verdade pelo painel.
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

  return router;
}
