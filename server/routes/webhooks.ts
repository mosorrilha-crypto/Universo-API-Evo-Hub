import crypto from 'crypto';
import { Router } from 'express';
import { parseMetaWebhookPayload, parseEvolutionWebhookPayload, parseEvoHubLifecycleEvent, friendlyLabelForOtherType, type ParsedIncomingMessage } from '../services/webhookParsers';
import { markProcessedIfNew, unmarkProcessed } from '../services/idempotency';
import { enqueueTranscriptionJob } from '../services/transcriptionQueue';
import { recordIncomingMessage, recordOutgoingMessage, getConversation, markGeoRestricted, attachAdReferralIfMissing } from '../services/conversationStore';
import { generateAutoReplyForText } from '../services/autoReply';
import { sendBubbles } from '../services/sendBubbles';
import { markAsReadAndShowTyping, isGeoRestrictedError } from '../services/metaSend';
import { showEvolutionTyping } from '../services/evolutionSend';
import { isAgentPaused } from '../services/agentStatus';
import { getKnowledgeBase, formatKnowledgeBaseForPrompt } from '../services/knowledgeBaseStore';
import { getTenantSegment } from '../services/tenantProfileStore';
import { runExclusive } from '../services/perPhoneQueue';
import { bufferIncomingText } from '../services/messageBuffer';
import { logEscalation, isPaymentRelated } from '../services/escalationStore';
import { downloadMetaMedia } from '../services/mediaDownload';
import { saveMediaImage } from '../services/mediaImageStore';
import { getAppointmentForPhone, markPaymentPendingVerification } from '../services/appointmentStore';
import { resolveTenantByPhoneNumberId, resolveTenantByEvolutionInstance, type ResolvedTenant } from '../services/tenantResolver';
import { redactMessageForLog } from '../services/logRedaction';
import type { GoogleGenAI } from '@google/genai';
import type { CalendarConfig } from '../services/googleCalendar';

interface WebhooksRouterDeps {
  metaWebhookVerifyToken: string;
  evoHubWebhookSecret?: string;
  getAi?: () => GoogleGenAI | null;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  /** Instância/URL/API key compartilhadas (fallback), mesmo papel de metaAccessToken/metaPhoneNumberId acima pra Porta A (Epic 4.6). */
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
}

export function createWebhooksRouter({ metaWebhookVerifyToken, evoHubWebhookSecret, getAi, metaAccessToken, metaPhoneNumberId, evolutionApiUrl, evolutionApiKey, evolutionInstanceName, supabaseUrl, supabaseKey, googleClientId, googleClientSecret, googleRedirectUri }: WebhooksRouterDeps): Router {
  const calendarConfig: CalendarConfig | undefined = googleRedirectUri
    ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri }
    : undefined;

  const router = Router();

  // Resposta automática pra mensagens de texto (Epic 1.3): gera e envia de
  // volta via Meta Cloud API, sem bloquear a resposta do webhook (fire-and-forget).
  //
  // resolvedTenant vem do Bloco 2.B (server/services/tenantResolver.ts) — já
  // é o tenant/credencial certos pra esse número, resolvidos por
  // phone_number_id antes de chegar aqui.
  const triggerAutoReply = (phone: string, contactName: string | undefined, text: string, messageId: string, historyExclude: number, resolvedTenant: ResolvedTenant) => {
    const { tenantId, metaAccessToken: token, metaPhoneNumberId: phoneNumberId } = resolvedTenant;
    const isEvolution = resolvedTenant.provider === 'evolution';
    const channel = isEvolution
      ? { provider: 'evolution' as const, evolutionInstanceName: resolvedTenant.evolutionInstanceName, evolutionApiUrl: resolvedTenant.evolutionApiUrl, evolutionApiKey: resolvedTenant.evolutionApiKey }
      : { provider: 'meta' as const, phoneNumberId, accessToken: token };
    if (!getAi) return;
    // runExclusive garante que, se a mensagem anterior desse número ainda
    // estiver gerando resposta, esta espera a vez — sem isso, uma chamada
    // lenta ao Gemini pode terminar DEPOIS de uma mais rápida disparada por
    // uma mensagem seguinte, respondendo fora de ordem (bug real observado).
    runExclusive(phone, async () => {
      if (await isAgentPaused(tenantId)) return;
      // Exclui as mensagens que acabaram de ser agrupadas pelo buffer (já
      // registradas individualmente antes do flush) — o resto é histórico real.
      const conversation = await getConversation(tenantId, phone);
      // Lead não qualificado/insistente que o operador bloqueou (menu ⋮ do
      // painel) — achado real em produção: um lead claramente fora do
      // público-alvo continuava recebendo resposta automática igual a
      // qualquer outro. Bloqueio é só desse número, não do tenant inteiro
      // (isAgentPaused acima continua valendo pra todos).
      if (conversation?.aiBlockedAt) return;
      const kbContext = formatKnowledgeBaseForPrompt(await getKnowledgeBase(tenantId));
      const segment = await getTenantSegment(tenantId);
      const history = conversation?.messages.slice(0, -historyExclude);
      try {
        // Ativa "digitando..." já durante a chamada ao Gemini (a espera mais
        // longa), não só na hora de enviar as bolhas.
        if (isEvolution) {
          await showEvolutionTyping(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey);
        } else {
          await markAsReadAndShowTyping(phoneNumberId, token, messageId);
        }
        // Ferramenta de envio de foto (Epic 4.5.2) fala só com a Meta hoje —
        // sem mediaConfig ela fica desativada (ver autoReply.ts), o que é o
        // comportamento certo pra um tenant conectado via Evolution.
        const result = await generateAutoReplyForText(tenantId, getAi!(), text, contactName, kbContext, history, phone, calendarConfig, segment, isEvolution ? undefined : { phoneNumberId, accessToken: token }, messageId, conversation?.adHeadline);
        if (!result) {
          await logEscalation(tenantId, phone, contactName, 'IA não conseguiu gerar resposta automática (falhou mesmo com retry)', text);
          // Achado real em produção (issue #82, item 4): mesmo com retry
          // (autoReply.ts), o Gemini pode ficar indisponível por mais tempo —
          // até agora isso virava silêncio total pro cliente, que só via a
          // fila de escalonamento (sem UI nenhuma até o item 2 desta mesma
          // issue) ser avisada. Nunca deixa o WhatsApp mudo: manda uma
          // mensagem de espera genérica, além do escalonamento de sempre.
          await sendBubbles(channel, phone, ['Peço desculpa pela demora — tivemos uma instabilidade rápida aqui do nosso lado. Já te retorno em instantes!'], async (bubbleText) => {
            await recordOutgoingMessage(tenantId, phone, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
          }, messageId);
          return;
        }
        if (result.agent === 'reclamacao') {
          await logEscalation(tenantId, phone, contactName, 'Cliente com reclamação — atendimento humano obrigatório, IA nunca resolve reclamação sozinha', text);
        } else if (result.agent === 'agendamento' && result.needsHumanConfirmation) {
          await logEscalation(tenantId, phone, contactName, 'Cliente tentando fechar agendamento — precisa de confirmação/atenção humana (dados insuficientes, agenda não conectada, ou falha ao agir na agenda real)', text);
        }
        await sendBubbles(channel, phone, result.bubbles, async (bubbleText) => {
          await recordOutgoingMessage(tenantId, phone, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
          console.log(`🤖 [Resposta Automática] tenant=${tenantId} Enviado pra ${phone}: ${redactMessageForLog(bubbleText)} (agente: ${result.agent})`);
        }, messageId, result.phase, result.routerElapsedMs);
      } catch (err: any) {
        if (isGeoRestrictedError(err)) {
          await markGeoRestricted(tenantId, phone, err.message);
          await logEscalation(tenantId, phone, contactName, 'Envio bloqueado por restrição geográfica — precisa de atendimento manual', text);
        } else {
          await logEscalation(tenantId, phone, contactName, `Falha ao responder automaticamente: ${err.message}`, text);
        }
        console.warn('❌ [Resposta Automática] Falhou:', err.message);
      }
    });
  };

  // Agrupa mensagens de texto picotadas (2-3 seguidas do mesmo número) antes
  // de disparar a resposta — espera ~6s de silêncio, evitando responder cada
  // fragmento separadamente (denunciaria automação na hora).
  const handleIncomingText = (phone: string, contactName: string | undefined, text: string, messageId: string, resolvedTenant: ResolvedTenant) => {
    bufferIncomingText(phone, contactName, text, messageId, resolvedTenant, (combinedText, bufferedContactName, lastMessageId, messageCount, bufferedTenant) => {
      triggerAutoReply(phone, bufferedContactName, combinedText, lastMessageId, messageCount, bufferedTenant);
    });
  };

  // Extrai as mensagens em um formato comum, resolve de qual tenant é cada
  // uma (Bloco 2.B — por phone_number_id, com fallback pro tenant legado +
  // credencial compartilhada se o número não estiver cadastrado ainda),
  // enfileira áudio pra transcrição (idempotente por message_id) e ignora o
  // resto (texto/imagem por ora — ver Epic 1.3 pra resposta automática).
  // Compartilhado entre os handlers de Meta/Evolution direto e o handler
  // dedicado do Evo Hub.
  const enqueueAudioMessages = async (parsedMessages: ParsedIncomingMessage[]) => {
    let enqueued = 0;
    const nowLabel = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    for (const msg of parsedMessages) {
      if (!markProcessedIfNew(msg.messageId)) {
        console.log(`↩️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} já processada, ignorando reentrega.`);
        continue;
      }

      // Tudo daqui pra baixo precisa de try/catch: markProcessedIfNew já
      // marcou essa mensagem como "vista" — se algo falhar sem desfazer
      // isso, a mensagem do lead some pra sempre (a reentrega da Meta, que
      // existe exatamente pra cobrir falha transitória, cai no `continue`
      // acima na próxima tentativa e nunca é gravada). Achado numa auditoria
      // pós-lançamento; corrigido pra sempre desmarcar em caso de erro real,
      // permitindo a reentrega tentar de novo.
      try {
        // Epic 4.6 — mensagem da Evolution API (Porta A) resolve o tenant
        // pela instância, não pelo phone_number_id (conceito que só existe
        // na Meta Cloud API/Porta B).
        const resolvedTenant = msg.provider === 'evolution'
          ? await resolveTenantByEvolutionInstance(msg.instanceName, { evolutionApiUrl, evolutionApiKey, evolutionInstanceName })
          : await resolveTenantByPhoneNumberId(msg.phoneNumberId, { metaAccessToken, metaPhoneNumberId });
        if (resolvedTenant.unknownChannel) {
          // Canal não identificado (Bloco 2.B, revisão de segurança 06/08/2026):
          // nunca gravar em tenant nenhum quando não dá pra provar de quem é a
          // mensagem — evita repetir o vazamento cross-tenant que existia
          // quando isso caía silenciosamente no tenant legado.
          console.warn(`⚠️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} de canal desconhecido (phone_number_id="${msg.phoneNumberId}") — descartada sem gravar em nenhum tenant.`);
          continue;
        }
        const { tenantId } = resolvedTenant;

        if (msg.referral?.ctwaClid) {
          attachAdReferralIfMissing(tenantId, msg.from, { ctwaClid: msg.referral.ctwaClid, adSourceId: msg.referral.sourceId, adHeadline: msg.referral.headline }).catch((err) =>
            console.warn(`⚠️  [Webhook ${msg.provider}] Falha ao gravar ctwa_clid de ${msg.from}:`, err.message)
          );
        }

        if (msg.type === 'audio') {
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'audio', text: '🎤 Transcrevendo áudio...', timestamp: nowLabel }, msg.messageId);
          enqueueTranscriptionJob(msg, resolvedTenant);
          enqueued += 1;
        } else if (msg.type === 'text') {
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'text', text: msg.text, timestamp: nowLabel });
          if (msg.text && isPaymentRelated(msg.text)) {
            await logEscalation(tenantId, msg.from, msg.contactName, 'Mensagem sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana', msg.text);
          }
          if (msg.text) handleIncomingText(msg.from, msg.contactName, msg.text, msg.messageId, resolvedTenant);
        } else if (msg.type === 'image') {
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'image', text: '📷 Imagem recebida', timestamp: nowLabel }, msg.messageId);
          if (msg.metaImage) {
            downloadMetaMedia(msg.metaImage.mediaId, resolvedTenant.metaAccessToken)
              .then((downloaded) => saveMediaImage(supabaseUrl, supabaseKey, msg.messageId, downloaded.base64, downloaded.mimeType))
              .catch((err) => console.warn(`❌ [Imagem] Falha ao baixar imagem de ${msg.from}:`, err.message));
          }
          // Etapa 8 (fluxo de verificação de pagamento) — uma imagem chegando
          // com um agendamento ativo ainda sem comprovante registrado é o
          // caso mais comum de "cliente mandou o comprovante da seña". Nunca
          // confirma nada sozinho: só marca pending_verification e escala pra
          // um operador olhar de verdade (ver server/services/appointmentStore.ts).
          getAppointmentForPhone(tenantId, msg.from)
            .then(async (appointment) => {
              if (!appointment || appointment.paymentStatus) return;
              await markPaymentPendingVerification(tenantId, msg.from, msg.messageId);
              await logEscalation(tenantId, msg.from, msg.contactName, 'Possível comprovante de pagamento recebido (imagem com agendamento ativo) — precisa de verificação humana antes de confirmar o turno', '[imagem]');
            })
            .catch((err) => console.warn(`❌ [Pagamento] Falha ao processar possível comprovante de ${msg.from}:`, err.message));
        } else {
          // Tipo de mensagem que não geramos resposta automática (sticker,
          // vídeo/gif, localização, reação, contato etc.) — grava com um
          // rótulo que descreve o que realmente chegou, em vez do
          // "[sticker]"/"[video]" cru de antes (achado real em produção).
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'text', text: friendlyLabelForOtherType(msg.rawType), timestamp: nowLabel });
        }
      } catch (err: any) {
        unmarkProcessed(msg.messageId);
        console.error(`❌ [Webhook ${msg.provider}] Falha ao processar mensagem ${msg.messageId} de ${msg.from} — desmarcada pra reentrega tentar de novo:`, err.message);
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

  const handleWebhookPayload = async (req: any, res: any) => {
    // Achado numa auditoria externa: a checagem só rodava "se o header
    // vier" — um POST sem x-hub-signature-256/x-hub-signature pulava a
    // validação inteira e era processado como legítimo (fail-open), mesmo
    // com o app secret configurado. Isso permitia forjar mensagens de
    // WhatsApp inteiras só omitindo o header. Corrigido pra fail-closed,
    // igual ao handleEvoHubWebhook já fazia: com o secret configurado, o
    // header é obrigatório.
    const signatureHeader = (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature']) as string | undefined;
    const appSecret = process.env.META_APP_SECRET || process.env.META_API_TOKEN;

    if (appSecret) {
      if (!signatureHeader) {
        console.warn('❌ Webhook Meta: assinatura ausente com app secret configurado. Rejeitando requisição.');
        return res.status(403).json({ error: 'Assinatura ausente.' });
      }
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
      const enqueued = await enqueueAudioMessages(parsedMessages);

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
      const enqueued = await enqueueAudioMessages(parsedMessages);

      if (messages && messages.length > 0) {
        const msg = messages[0];
        // tenant ainda não resolvido neste ponto (resolução acontece por
        // mensagem dentro de enqueueAudioMessages) — log de diagnóstico do
        // payload bruto, conteúdo sempre redigido.
        console.log(`📱 [Webhook Meta WhatsApp] Nova mensagem de ${msg.from}:`, msg.text?.body ? redactMessageForLog(msg.text.body) : `[Tipo: ${msg.type}]`, enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
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

  const handleEvoHubWebhook = async (req: any, res: any) => {
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
      const enqueued = await enqueueAudioMessages(parsedMessages);

      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      if (messages && messages.length > 0) {
        const msg = messages[0];
        console.log(`📱 [Webhook Evo Hub] Nova mensagem de ${msg.from}:`, msg.text?.body ? redactMessageForLog(msg.text.body) : `[Tipo: ${msg.type}]`, enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
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
