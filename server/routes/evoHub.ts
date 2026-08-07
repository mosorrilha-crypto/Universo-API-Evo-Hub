import { Router, type RequestHandler } from 'express';
import { redactMessageForLog } from '../services/logRedaction';
import { asyncHandler } from '../middleware/asyncHandler';

interface EvoHubRouterDeps {
  authenticateEvoHub: RequestHandler;
}

// ==========================================
// EVO HUB — REST API PLATAFORMA DE INTEGRAÇÃO
// ==========================================
// Facade próprio (mock): estas rotas /api/v1/* não chamam a api.evohub.ai
// real, servem como um substituto compatível pra desenvolvimento/demo.
export function createEvoHubRouter({ authenticateEvoHub }: EvoHubRouterDeps): Router {
  const router = Router();

  // In-Memory Database for Channels, Webhooks, Templates
  const evoChannels: Array<{
    id: string;
    name: string;
    type: 'whatsapp' | 'facebook' | 'instagram' | 'unified';
    status: 'active' | 'inactive' | 'pending';
    token: string;
    external_id?: string;
    metadata?: any;
    created_at: string;
  }> = [
    {
      id: 'ch_uuid_whatsapp_01',
      name: 'Monique Sorrilha Studio - WhatsApp Principal',
      type: 'whatsapp',
      status: 'active',
      token: '3b7fbadc92ba518a24055abfbf80106a581834c2cd2569bba63df67d90859caa',
      metadata: {
        meta_connection: {
          phone_number_id: process.env.META_PHONE_NUMBER_ID || '1129276996946667',
          waba_id: process.env.META_WABA_ID || '1029324622797347',
          phone_number: '+55 11 99999-8888',
          display_name: 'Monique Sorrilha Beauty'
        }
      },
      created_at: new Date().toISOString()
    },
    {
      id: 'ch_uuid_social_02',
      name: 'Atendimento Unificado Instagram & Facebook Direct',
      type: 'unified',
      status: 'active',
      token: 'evh_tok_social_direct_998877665544332211',
      metadata: {
        instagram_account_id: '17841401234567890',
        page_id: '1051028587634264'
      },
      created_at: new Date().toISOString()
    }
  ];

  const evoWebhooks: Array<{
    id: string;
    name: string;
    url: string;
    events: string[];
    status: 'active' | 'inactive';
    created_at: string;
  }> = [
    {
      id: 'wh_uuid_01',
      name: 'CRM Webhook Principal Universo.ai',
      url: process.env.WEBHOOK_URL || 'https://universo.ai.studio/webhook',
      events: ['channel_connected', 'event_received', 'webhook_delivered', 'MESSAGES_UPSERT'],
      status: 'active',
      created_at: new Date().toISOString()
    }
  ];

  const evoTemplates: Array<{
    id: string;
    name: string;
    language: string;
    category: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    body?: string;
  }> = [
    { id: 't_1', name: 'confirmacao_seia', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED', body: 'Olá {{1}}, confirmamos sua presença para {{2}}.' },
    { id: 't_2', name: 'lembrete_procedimento', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Lembrete: Seu procedimento com Dra. Monique está agendado para {{1}}.' }
  ];

  // 1. GET /api/v1/channels — Listar todos os canais de conexão
  router.get('/api/v1/channels', authenticateEvoHub, (req, res) => {
    res.json({
      success: true,
      total: evoChannels.length,
      channels: evoChannels.map(ch => ({
        ...ch,
        public_connect_link: `https://universo.ai.studio/webhook?channel_token=${ch.token}`
      }))
    });
  });

  // 2. POST /api/v1/channels — Criar ou registrar novo canal de conexão Meta / WhatsApp / Instagram / Facebook
  router.post('/api/v1/channels', authenticateEvoHub, (req, res) => {
    const { name, type, phone_number, waba_id, phone_number_id, metadata } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'O campo "name" é obrigatório para criar o canal.' });
    }

    const channelId = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channelToken = `evo_tok_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

    const newChannel = {
      id: channelId,
      name: String(name),
      type: (['whatsapp', 'facebook', 'instagram', 'unified'].includes(type) ? type : 'whatsapp') as any,
      status: 'active' as const,
      token: channelToken,
      metadata: {
        meta_connection: {
          phone_number_id: phone_number_id || process.env.META_PHONE_NUMBER_ID || '1129276996946667',
          waba_id: waba_id || process.env.META_WABA_ID || '1029324622797347',
          phone_number: phone_number || '+55 11 99999-8888',
          display_name: name
        },
        ...metadata
      },
      created_at: new Date().toISOString()
    };

    evoChannels.unshift(newChannel);

    console.log(`🚀 [Evo Hub REST API] Novo Canal Criado: ${newChannel.name} (ID: ${newChannel.id})`);

    res.status(201).json({
      success: true,
      message: 'Canal de conexão criado com sucesso no Evo Hub',
      channel: {
        ...newChannel,
        public_connect_link: `https://universo.ai.studio/webhook?channel_token=${newChannel.token}`
      }
    });
  });

  // 3. GET /api/v1/channels/:id — Buscar detalhes de um canal por ID ou Token
  router.get('/api/v1/channels/:id', authenticateEvoHub, (req, res) => {
    const { id } = req.params;
    const channel = evoChannels.find(c => c.id === id || c.token === id);

    if (!channel) {
      return res.status(404).json({ error: 'Canal não encontrado' });
    }

    res.json({
      success: true,
      channel: {
        ...channel,
        public_connect_link: `https://universo.ai.studio/webhook?channel_token=${channel.token}`
      }
    });
  });

  // 4. PUT / PATCH /api/v1/channels/:id — Atualizar status ou configurações de um canal
  const updateChannelHandler = (req: any, res: any) => {
    const { id } = req.params;
    const { name, status, metadata } = req.body || {};
    const channelIndex = evoChannels.findIndex(c => c.id === id || c.token === id);

    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal não encontrado para atualização' });
    }

    if (name) evoChannels[channelIndex].name = name;
    if (status && ['active', 'inactive', 'pending'].includes(status)) evoChannels[channelIndex].status = status;
    if (metadata) evoChannels[channelIndex].metadata = { ...evoChannels[channelIndex].metadata, ...metadata };

    res.json({
      success: true,
      message: 'Canal atualizado com sucesso',
      channel: evoChannels[channelIndex]
    });
  };

  router.put('/api/v1/channels/:id', authenticateEvoHub, updateChannelHandler);
  router.patch('/api/v1/channels/:id', authenticateEvoHub, updateChannelHandler);

  // 5. DELETE /api/v1/channels/:id — Remover canal
  router.delete('/api/v1/channels/:id', authenticateEvoHub, (req, res) => {
    const { id } = req.params;
    const index = evoChannels.findIndex(c => c.id === id || c.token === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Canal não encontrado para exclusão' });
    }

    const removed = evoChannels.splice(index, 1)[0];
    res.json({
      success: true,
      message: `Canal "${removed.name}" removido com sucesso do Evo Hub`
    });
  });

  // 6. POST /api/v1/channels/:id/connect — Acionar conexão/reconexão com a Meta Cloud API
  router.post('/api/v1/channels/:id/connect', authenticateEvoHub, (req, res) => {
    const { id } = req.params;
    const channel = evoChannels.find(c => c.id === id || c.token === id);

    if (!channel) {
      return res.status(404).json({ error: 'Canal não encontrado' });
    }

    channel.status = 'active';

    res.json({
      success: true,
      message: 'Ponte automatizada com a Meta Cloud API estabelecida!',
      connection: {
        channel_id: channel.id,
        channel_name: channel.name,
        status: 'connected',
        meta_waba_id: process.env.META_WABA_ID || '1029324622797347',
        meta_phone_number_id: process.env.META_PHONE_NUMBER_ID || '1129276996946667',
        webhook_registered_url: process.env.WEBHOOK_URL || 'https://universo.ai.studio/webhook',
        connected_at: new Date().toISOString()
      }
    });
  });

  // 7. POST /api/v1/messages/send — Disparar mensagens de texto/mídia via canal
  router.post('/api/v1/messages/send', authenticateEvoHub, asyncHandler(async (req, res) => {
    const { channel_id, to, number, type = 'text', text, body, media, caption } = req.body || {};
    const targetNumber = to || number || '5511999998888';
    const messageText = typeof text === 'string' ? text : text?.body || body || 'Mensagem do Evo Hub';

    console.log(`📤 [Evo Hub REST API] Enviando mensagem para ${targetNumber}:`, redactMessageForLog(messageText));

    const messageId = `wamid.HBgL${Math.random().toString(36).substring(2, 10)}${Math.floor(Math.random() * 1000000)}`;

    res.json({
      success: true,
      messaging_product: 'whatsapp',
      contacts: [{ input: targetNumber, wa_id: targetNumber.replace(/\D/g, '') }],
      messages: [{ id: messageId }],
      status: 'sent',
      channel_id: channel_id || evoChannels[0]?.id || 'ch_uuid_whatsapp_01',
      sent_at: new Date().toISOString()
    });
  }));

  // 8. GET & POST /api/v1/webhooks — Gerenciar Webhooks no Evo Hub
  router.get('/api/v1/webhooks', authenticateEvoHub, (req, res) => {
    res.json({
      success: true,
      total: evoWebhooks.length,
      webhooks: evoWebhooks
    });
  });

  router.post('/api/v1/webhooks', authenticateEvoHub, (req, res) => {
    const { name, url, events } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'A URL do webhook é obrigatória' });
    }

    const newWebhook = {
      id: `wh_${Date.now()}`,
      name: name || 'Webhook Personalizado',
      url,
      events: Array.isArray(events) ? events : ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      status: 'active' as const,
      created_at: new Date().toISOString()
    };

    evoWebhooks.push(newWebhook);
    res.status(201).json({ success: true, message: 'Webhook registrado no Evo Hub', webhook: newWebhook });
  });

  router.delete('/api/v1/webhooks/:id', authenticateEvoHub, (req, res) => {
    const { id } = req.params;
    const idx = evoWebhooks.findIndex(w => w.id === id);
    if (idx !== -1) evoWebhooks.splice(idx, 1);
    res.json({ success: true, message: 'Webhook removido' });
  });

  // 9. GET & POST /api/v1/templates — Templates de Mensagens WhatsApp
  router.get('/api/v1/templates', authenticateEvoHub, (req, res) => {
    res.json({ success: true, total: evoTemplates.length, templates: evoTemplates });
  });

  router.post('/api/v1/templates', authenticateEvoHub, (req, res) => {
    const { name, category, language = 'pt_BR', body } = req.body || {};
    const newTemplate = {
      id: `t_${Date.now()}`,
      name: name || 'novo_template',
      category: category || 'MARKETING',
      language,
      status: 'APPROVED' as const,
      body: body || ''
    };
    evoTemplates.push(newTemplate);
    res.status(201).json({ success: true, message: 'Template aprovado no Evo Hub', template: newTemplate });
  });

  // 10. PROXY META GRAPH API — Forwarder para /api/v1/meta/* ou /v23.0/*
  router.all('/api/v1/meta/*', authenticateEvoHub, (req, res) => {
    const endpointPath = req.params[0] || '';
    res.json({
      success: true,
      gateway: 'Evo Hub Meta Proxy (/api/v1/meta/*)',
      forwarded_to: `https://graph.facebook.com/v23.0/${endpointPath}`,
      method: req.method,
      status: 200,
      response: {
        messaging_product: 'whatsapp',
        contacts: [{ input: req.body?.to || '5511999998888', wa_id: '5511999998888' }],
        messages: [{ id: `wamid.HBgL${Math.random().toString(36).substring(2, 10)}` }]
      },
      executed_at: new Date().toISOString()
    });
  });

  return router;
}
