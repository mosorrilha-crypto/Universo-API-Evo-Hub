import crypto from 'crypto';
import { Router } from 'express';
import { parseMetaWebhookPayload, parseEvolutionWebhookPayload } from '../services/webhookParsers';
import { markProcessedIfNew } from '../services/idempotency';
import { enqueueTranscriptionJob } from '../services/transcriptionQueue';

interface WebhooksRouterDeps {
  metaWebhookVerifyToken: string;
}

export function createWebhooksRouter({ metaWebhookVerifyToken }: WebhooksRouterDeps): Router {
  const router = Router();

  const handleWebhookVerification = (req: any, res: any) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = metaWebhookVerifyToken;

    if (challenge) {
      if (mode === 'subscribe' && token && token !== verifyToken) {
        return res.status(403).json({ error: 'Token de verificação inválido' });
      }
      return res.status(200).send(challenge);
    }

    return res.status(200).json({
      status: 'active',
      name: process.env.EVOLUTION_INSTANCE_NAME || 'WhatsApp Universo.ai',
      url: process.env.WEBHOOK_URL || 'https://universo.ai.studio/webhook',
      key: process.env.WEBHOOK_KEY || 'https://universo.ai.studio/webhook',
      message: 'Webhook WhatsApp Universo.ai operando e pronto para receber eventos.'
    });
  };

  const handleWebhookPayload = (req: any, res: any) => {
    // Check HMAC signature if Meta header is present
    const signatureHeader = (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature']) as string | undefined;
    const appSecret = process.env.META_APP_SECRET || process.env.META_API_TOKEN;

    if (signatureHeader && appSecret) {
      try {
        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
        const hash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
        const expectedSignature = signatureHeader.startsWith('sha256=') ? `sha256=${hash}` : hash;

        const sigBuffer = Buffer.from(signatureHeader);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          console.warn('❌ Webhook Meta: Assinatura HMAC-SHA256 inválida. Rejeitando requisição fraudulenta.');
          return res.status(403).json({ error: 'Assinatura HMAC-SHA256 inválida. Requisição rejeitada.' });
        }
      } catch (err) {
        console.error('Erro na validação HMAC do Webhook Meta:', err);
        return res.status(403).json({ error: 'Erro ao validar assinatura HMAC-SHA256.' });
      }
    }

    const body = req.body || {};

    // Extrai as mensagens em um formato comum, enfileira áudio pra transcrição
    // (idempotente por message_id) e ignora o resto (texto/imagem por ora —
    // ver Epic 1.3 pra resposta automática).
    const enqueueAudioMessages = (parsedMessages: ReturnType<typeof parseMetaWebhookPayload>) => {
      let enqueued = 0;
      for (const msg of parsedMessages) {
        if (msg.type !== 'audio') continue;
        if (!markProcessedIfNew(msg.messageId)) {
          console.log(`↩️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} já processada, ignorando reentrega.`);
          continue;
        }
        enqueueTranscriptionJob(msg);
        enqueued += 1;
      }
      return enqueued;
    };

    // 1. Evolution API v2 Format (e.g. MESSAGES_UPSERT, CONNECTION_UPDATE)
    if (body.event || body.instance) {
      const eventName = body.event || 'EVOLUTION_EVENT';
      const instance = body.instance || process.env.EVOLUTION_INSTANCE_NAME || 'WhatsApp Universo.ai';
      const data = body.data || body;

      const parsedMessages = parseEvolutionWebhookPayload(body);
      const enqueued = enqueueAudioMessages(parsedMessages);

      console.log(`📱 [Evolution Webhook ${instance}] Evento: ${eventName}`, data?.key ? `(Key: ${data.key.id})` : '', enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');

      return res.status(200).json({
        success: true,
        instance,
        event: eventName,
        message: 'Evento Evolution API processado com sucesso',
        timestamp: new Date().toISOString()
      });
    }

    // 2. Meta WhatsApp Cloud API Format
    if (body?.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      const parsedMessages = parseMetaWebhookPayload(body);
      const enqueued = enqueueAudioMessages(parsedMessages);

      if (messages && messages.length > 0) {
        const msg = messages[0];
        console.log(`📱 [Webhook Meta WhatsApp] Nova mensagem de ${msg.from}:`, msg.text?.body || `[Tipo: ${msg.type}]`, enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
      }

      return res.status(200).json({
        success: true,
        message: 'Evento do WhatsApp Meta processado com sucesso',
        processedMessages: messages?.length || 0,
      });
    }

    return res.status(200).json({
      success: true,
      name: process.env.EVOLUTION_INSTANCE_NAME || 'WhatsApp Universo.ai',
      url: process.env.WEBHOOK_URL || 'https://universo.ai.studio/webhook',
      message: 'Webhook recebido e processado com sucesso',
      receivedAt: new Date().toISOString()
    });
  };

  // Webhook Routes (Supports /webhook, /api/webhooks/meta, /api/webhooks/evolution, /api/webhooks/whatsapp)
  router.get('/webhook', handleWebhookVerification);
  router.post('/webhook', handleWebhookPayload);

  router.get('/api/webhooks/meta', handleWebhookVerification);
  router.post('/api/webhooks/meta', handleWebhookPayload);

  router.get('/api/webhooks/evolution', handleWebhookVerification);
  router.post('/api/webhooks/evolution', handleWebhookPayload);

  // Alias: o EvoHubIntegration.tsx usa esse caminho como URL padrão de webhook
  // no frontend — sem essa rota, ele apontava pra um endpoint inexistente (404).
  router.get('/api/webhooks/evolution_hub', handleWebhookVerification);
  router.post('/api/webhooks/evolution_hub', handleWebhookPayload);

  router.get('/api/webhooks/whatsapp', handleWebhookVerification);
  router.post('/api/webhooks/whatsapp', handleWebhookPayload);

  return router;
}
