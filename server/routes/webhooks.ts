import crypto from 'crypto';
import { Router } from 'express';
import { parseMetaWebhookPayload, parseEvolutionWebhookPayload, parseEvoHubLifecycleEvent, type ParsedIncomingMessage } from '../services/webhookParsers';
import { markProcessedIfNew } from '../services/idempotency';
import { enqueueTranscriptionJob } from '../services/transcriptionQueue';
import { recordIncomingMessage, recordOutgoingMessage } from '../services/conversationStore';
import { generateAutoReplyForText } from '../services/autoReply';
import { sendWhatsAppTextMessage } from '../services/metaSend';
import type { GoogleGenAI } from '@google/genai';

interface WebhooksRouterDeps {
  metaWebhookVerifyToken: string;
  evoHubWebhookSecret?: string;
  getAi?: () => GoogleGenAI | null;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

export function createWebhooksRouter({ metaWebhookVerifyToken, evoHubWebhookSecret, getAi, metaAccessToken, metaPhoneNumberId }: WebhooksRouterDeps): Router {
  const router = Router();

  // Resposta automática pra mensagens de texto (Epic 1.3): gera e envia de
  // volta via Meta Cloud API, sem bloquear a resposta do webhook (fire-and-forget).
  const triggerAutoReply = (phone: string, contactName: string | undefined, text: string) => {
    if (!getAi) return;
    generateAutoReplyForText(getAi(), text, contactName)
      .then(async (reply) => {
        if (!reply) return;
        await sendWhatsAppTextMessage(metaPhoneNumberId, metaAccessToken, phone, reply);
        recordOutgoingMessage(phone, { type: 'text', text: reply, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
        console.log(`🤖 [Resposta Automática] Enviado pra ${phone}: "${reply}"`);
      })
      .catch((err) => console.warn('❌ [Resposta Automática] Falhou:', err.message));
  };

  // Extrai as mensagens em um formato comum, enfileira áudio pra transcrição
  // (idempotente por message_id) e ignora o resto (texto/imagem por ora —
  // ver Epic 1.3 pra resposta automática). Compartilhado entre os handlers de
  // Meta/Evolution direto e o handler dedicado do Evo Hub.
  const enqueueAudioMessages = (parsedMessages: ParsedIncomingMessage[]) => {
    let enqueued = 0;
    const nowLabel = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    for (const msg of parsedMessages) {
      if (!markProcessedIfNew(msg.messageId)) {
        console.log(`↩️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} já processada, ignorando reentrega.`);
        continue;
      }

      if (msg.type === 'audio') {
        recordIncomingMessage(msg.from, msg.contactName, { type: 'audio', text: '🎤 Transcrevendo áudio...', timestamp: nowLabel }, msg.messageId);
        enqueueTranscriptionJob(msg);
        enqueued += 1;
      } else if (msg.type === 'text') {
        recordIncomingMessage(msg.from, msg.contactName, { type: 'text', text: msg.text, timestamp: nowLabel });
        if (msg.text) triggerAutoReply(msg.from, msg.contactName, msg.text);
      } else {
        recordIncomingMessage(msg.from, msg.contactName, { type: msg.type === 'image' ? 'image' : 'text', text: msg.type === 'image' ? '📷 Imagem recebida' : `[${msg.type}]`, timestamp: nowLabel });
      }
    }
    return enqueued;
  };

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

  /**
   * Webhook dedicado do Evo Hub real (api.evohub.ai, canal BYO). Diferente do
   * handler genérico acima: a assinatura HMAC usa o webhook_secret que a gente
   * escolhe ao criar o canal (EVO_HUB_WEBHOOK_SECRET), não o META_APP_SECRET —
   * o Hub é quem fala com a Meta, nunca recebemos o payload direto dela. Não
   * expõe o alias /api/webhooks/evolution_hub (esse é o endpoint mockado do
   * nosso próprio facade /api/v1/*, usado só como URL de exemplo no frontend).
   */
  const handleEvoHubVerification = (req: any, res: any) => {
    res.status(200).json({
      status: 'active',
      message: 'Webhook do Evo Hub (real) operando e pronto para receber eventos.',
    });
  };

  const handleEvoHubWebhook = (req: any, res: any) => {
    const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;

    if (evoHubWebhookSecret) {
      if (!signatureHeader) {
        console.warn('❌ Webhook Evo Hub: assinatura ausente. Rejeitando requisição.');
        return res.status(403).json({ error: 'Assinatura ausente.' });
      }
      try {
        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
        const hash = crypto.createHmac('sha256', evoHubWebhookSecret).update(rawBody).digest('hex');
        const expectedSignature = `sha256=${hash}`;
        const sigBuffer = Buffer.from(signatureHeader);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          console.warn('❌ Webhook Evo Hub: assinatura HMAC-SHA256 inválida. Rejeitando requisição fraudulenta.');
          return res.status(403).json({ error: 'Assinatura HMAC-SHA256 inválida. Requisição rejeitada.' });
        }
      } catch (err) {
        console.error('Erro na validação HMAC do Webhook Evo Hub:', err);
        return res.status(403).json({ error: 'Erro ao validar assinatura HMAC-SHA256.' });
      }
    } else {
      console.warn('⚠️  EVO_HUB_WEBHOOK_SECRET não configurado — aceitando webhook do Evo Hub sem verificar assinatura (dev only).');
    }

    const body = req.body || {};

    // Evento de ciclo de vida do canal (conectado/desconectado etc.) — não é
    // mensagem de WhatsApp, só log por ora.
    const lifecycle = parseEvoHubLifecycleEvent(body);
    if (lifecycle) {
      console.log(`🔔 [Evo Hub] Evento de ciclo de vida: ${lifecycle.eventName}`, lifecycle.details);
      return res.status(200).json({ success: true, received: 'lifecycle_event' });
    }

    // Passthrough de mensagem no formato Meta Cloud API (BYO: o Hub repassa a
    // estrutura oficial da Meta sem alterar).
    if (body?.object === 'whatsapp_business_account') {
      const parsedMessages = parseMetaWebhookPayload(body, 'evohub');
      const enqueued = enqueueAudioMessages(parsedMessages);

      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      if (messages && messages.length > 0) {
        const msg = messages[0];
        console.log(`📱 [Webhook Evo Hub] Nova mensagem de ${msg.from}:`, msg.text?.body || `[Tipo: ${msg.type}]`, enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
      }

      return res.status(200).json({ success: true, processedMessages: messages?.length || 0 });
    }

    console.warn('🔔 [Evo Hub] Payload de webhook não reconhecido:', JSON.stringify(body).slice(0, 500));
    return res.status(200).json({ success: true, received: 'unknown_payload' });
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

  // Endpoint dedicado do Evo Hub real — é esse que deve ser cadastrado como
  // webhook_url ao criar o canal via POST /api/v1/channels no Evo Hub.
  router.get('/api/webhooks/evohub', handleEvoHubVerification);
  router.post('/api/webhooks/evohub', handleEvoHubWebhook);

  return router;
}
