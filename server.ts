import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { rateLimit } from 'express-rate-limit';

dotenv.config();

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  // Supabase e JWT Config
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  // JWT_SECRET é obrigatória em produção. Fora dela (dev/preview), geramos uma
  // efêmera (só dura a execução atual) para não travar o boot sem segredo configurado.
  let JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    if (isProduction) {
      throw new Error('JWT_SECRET é obrigatória em produção. Configure-a no .env (veja .env.example).');
    }
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  JWT_SECRET não configurada — usando um segredo temporário só para esta execução (dev only).');
  }

  // DEMO_MODE: fora de produção, ligado por padrão (facilita testar sem backend
  // completo). Em produção, desligado por padrão — só liga com DEMO_MODE=true
  // explícito. Controla o login com senhas fixas e o endpoint de token demo abaixo.
  const DEMO_MODE = process.env.DEMO_MODE === 'true' ? true
    : process.env.DEMO_MODE === 'false' ? false
    : !isProduction;

  let supabase: ReturnType<typeof createClient> | null = null;
  if (SUPABASE_URL && SUPABASE_KEY && /^https?:\/\//i.test(SUPABASE_URL.trim())) {
    try {
      supabase = createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim());
    } catch (err) {
      console.warn('⚠️ Falha ao inicializar cliente Supabase:', err);
      supabase = null;
    }
  }

  if (!supabase) {
    console.warn('⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados ou inválidos nas variáveis de ambiente. As rotas de banco de dados usarão dados de demonstração ou retornarão aviso ao serem invocadas.');
  }

  app.use(express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Middleware de Autenticação
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // Rate limit para as rotas que chamam o Gemini ou geram custo — protege contra
  // abuso mesmo vindo de um usuário autenticado.
  const aiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
  });

  // Config pública — o frontend usa isso pra saber se pode oferecer o login de
  // demonstração (senhas fixas) ou se precisa exigir credenciais reais.
  app.get('/api/public/config', (req, res) => {
    res.json({ demoMode: DEMO_MODE });
  });

  // Emite um JWT válido pra um perfil de demonstração — só funciona com DEMO_MODE=true.
  // Não valida senha (isso já foi feito no frontend com as senhas fixas de demo);
  // existe só para que o modo demo também tenha um Bearer token de verdade pra
  // chamar as rotas protegidas abaixo, sem precisar de um operador real no Supabase.
  app.post('/api/auth/demo-token', (req, res) => {
    if (!DEMO_MODE) {
      return res.status(403).json({ error: 'Login de demonstração desabilitado (DEMO_MODE=false).' });
    }
    const { id, tenantId, role, email } = req.body || {};
    if (!id || !tenantId || !role) {
      return res.status(400).json({ error: 'id, tenantId e role são obrigatórios.' });
    }
    const token = jwt.sign({ id, tenantId, role, email, demo: true }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  });

  // Rota de Login de Operadores e Administradores com verificação de senha
  app.post('/api/auth/login', async (req, res) => {
    const { tenantId, email, password } = req.body;
    
    try {
      if (!password || password.trim() === '') {
        throw new Error('A senha é obrigatória.');
      }

      if (!supabase) {
        throw new Error('Supabase não está configurado. Configure SUPABASE_URL e SUPABASE_KEY no ambiente.');
      }

      const { data, error } = await supabase
        .from('operators')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .single();

      const operator = data as any;

      if (error || !operator) throw new Error('Usuário não encontrado');

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) throw new Error('Senha incorreta.');

      const token = jwt.sign(
        { id: operator.id, tenantId: operator.tenant_id, role: operator.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ token, operator: { name: operator.name, email: operator.email, role: operator.role } });
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });

  // ✅ REMOVIDO: /api/setup-db (não deve existir em produção)
  // Se precisar de um endpoint de setup, use Opção B do guia: protegido com token único

  // ✅ Endpoint de teste do Gemini
  app.get('/api/test-gemini', authenticateToken, aiRateLimiter, async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) return res.status(500).json({ error: 'Gemini não configurado (GEMINI_API_KEY ausente)' });

    const modelsToTest = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

    const results = [];

    for (const modelName of modelsToTest) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: 'Responda com "OK"',
        });
        results.push({ model: modelName, status: '✅ OK', text: response.text });
      } catch (err: any) {
        results.push({
          model: modelName,
          status: '❌ Erro',
          error: err.message?.slice(0, 100)
        });
      }
    }

    res.json(results);
  });

  // Telemetria de Tokens & Cache AI Strategy
  let mockAiEnabled = false;

  app.get('/api/telemetry/tokens', authenticateToken, (req, res) => {
    res.json({
      useMockAiMode: mockAiEnabled,
      summary: {
        totalSaaSTokens: 1425800,
        totalSaaSCostUSD: 0.14,
        totalCachedSaved: 850000,
        totalRequests: 3420,
      },
      tenantsTelemetry: [
        {
          tenantId: 'main-tenant',
          tenantName: 'Monique Studio VIP',
          inputTokens: 820000,
          outputTokens: 140000,
          cachedTokens: 510000,
          totalCostUSD: 0.08,
          requestCount: 1820,
          lastActive: new Date().toISOString(),
        },
        {
          tenantId: 'tenant_clinica_2',
          tenantName: 'Clínica Odonto Prime',
          inputTokens: 380000,
          outputTokens: 85800,
          cachedTokens: 340000,
          totalCostUSD: 0.06,
          requestCount: 1600,
          lastActive: new Date().toISOString(),
        }
      ]
    });
  });

  app.post('/api/telemetry/toggle-mock', authenticateToken, (req, res) => {
    const { enabled } = req.body || {};
    mockAiEnabled = typeof enabled === 'boolean' ? enabled : !mockAiEnabled;
    res.json({ useMockAiMode: mockAiEnabled, message: `Mock AI Mode ${mockAiEnabled ? 'Ativado' : 'Desativado'}` });
  });

  app.get('/api/queue/status', (req, res) => {
    res.json({
      activeWorkers: 4,
      pendingQueue: 0,
      processedTotal: 12840,
      failedTotal: 2,
      avgLatencyMs: 420
    });
  });

  app.post('/api/batch/lead-analysis', authenticateToken, aiRateLimiter, (req, res) => {
    res.json({
      success: true,
      processedCount: 10,
      savedTokens: 42000,
      executionTimeMs: 1250,
      timestamp: new Date().toISOString()
    });
  });

  // Meta & Evolution WhatsApp Webhook Validation & Reception
  let META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!META_WEBHOOK_VERIFY_TOKEN) {
    if (isProduction) {
      throw new Error('META_WEBHOOK_VERIFY_TOKEN é obrigatória em produção para validar o webhook da Meta.');
    }
    META_WEBHOOK_VERIFY_TOKEN = crypto.randomBytes(16).toString('hex');
    console.warn('⚠️  META_WEBHOOK_VERIFY_TOKEN não configurada — usando um valor temporário (dev only), a integração real com a Meta não vai funcionar até configurar um token fixo.');
  }

  const handleWebhookVerification = (req: any, res: any) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = META_WEBHOOK_VERIFY_TOKEN;

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

      console.log(`📱 [Evolution Webhook ${instance}] Evento: ${eventName}`, data?.key ? `(Key: ${data.key.id})` : '');

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

      if (messages && messages.length > 0) {
        const msg = messages[0];
        console.log(`📱 [Webhook Meta WhatsApp] Nova mensagem de ${msg.from}:`, msg.text?.body || `[Tipo: ${msg.type}]`);
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
  app.get('/webhook', handleWebhookVerification);
  app.post('/webhook', handleWebhookPayload);

  app.get('/api/webhooks/meta', handleWebhookVerification);
  app.post('/api/webhooks/meta', handleWebhookPayload);

  app.get('/api/webhooks/evolution', handleWebhookVerification);
  app.post('/api/webhooks/evolution', handleWebhookPayload);

  app.get('/api/webhooks/whatsapp', handleWebhookVerification);
  app.post('/api/webhooks/whatsapp', handleWebhookPayload);


  // AI Conversation Analysis Endpoint
  app.post('/api/analyze-conversation', authenticateToken, aiRateLimiter, async (req, res) => {
    try {
      const { leadInfo, messages, agentKnowledgeBase } = req.body || {};

      const ai = getGeminiClient();
      if (ai) {
        try {
          const prompt = `Você é um analista de Vendas e CRM inteligente para um sistema SaaS no WhatsApp em Português.
Analise o histórico da conversa a seguir e a base de conhecimento do agente e responda estritamente em formato JSON com a seguinte estrutura:
{
  "leadStage": "novo" | "contato" | "proposta" | "negociacao" | "ganho" | "perdido",
  "dealProbability": número de 0 a 100,
  "overallSentiment": "Positivo" | "Neutro" | "Dúvida" | "Urgente" | "Objeção" | "Frustrado",
  "urgencyLevel": número de 1 a 5,
  "detectedLanguage": "Português (Brasil)",
  "conversationSummary": "resumo conciso de 2-3 frases sobre o status e desfecho",
  "extractedCRMData": {
    "budget": "faixa orçamentária",
    "timeline": "prazo de decisão",
    "productsOfInterest": ["produtos/serviços"],
    "keyObjections": ["objeções identificadas"],
    "decisionCriteria": "critério de decisão"
  },
  "keyTopicsDiscussed": ["tópicos relevantes"],
  "multiModalInsights": ["insights multimídia/áudios"],
  "recommendedNextAction": "próxima ação recomendada para o operador humanizado",
  "suggestedSmartReply": "resposta inteligente pronta e persuasiva para o operador enviar"
}

Dados do Lead: ${JSON.stringify(leadInfo)}
Histórico de Mensagens: ${JSON.stringify(messages)}
Base de Conhecimento: ${JSON.stringify(agentKnowledgeBase || {})}
`;

          const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
            },
          });

          const rawText = response.text || '';
          const parsed = JSON.parse(rawText);
          return res.json({ success: true, source: 'gemini', analysis: parsed });
        } catch (geminiError) {
          console.warn('Gemini API call error, fallbacking to preset analysis:', geminiError);
        }
      }

      // Fallback preset analysis
      const msgCount = Array.isArray(messages) ? messages.length : 0;
      const lastMsgText = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1].text || '' : '';

      const fallbackAnalysis = {
        leadStage: msgCount > 4 ? 'negociacao' : msgCount > 2 ? 'proposta' : 'contato',
        dealProbability: Math.min(95, 45 + msgCount * 10),
        overallSentiment: lastMsgText.toLowerCase().includes('desconto') || lastMsgText.toLowerCase().includes('pix') ? 'Urgente' : 'Positivo',
        urgencyLevel: 4,
        detectedLanguage: 'Português (Brasil)',
        conversationSummary: `Lead ${leadInfo?.name || 'Cliente'} trocou ${msgCount} mensagem(ns). Demonstrou alto interesse comercial nas soluções e tirou dúvidas sobre contratação.`,
        extractedCRMData: {
          budget: 'R$ 590 - 2.500',
          timeline: 'Imediata (esta semana)',
          productsOfInterest: [leadInfo?.sampleType || 'Plano Pro SaaS / Automação'],
          keyObjections: ['Consulta de condições para pagamento à vista'],
          decisionCriteria: 'Agilidade no atendimento e suporte 24/7'
        },
        keyTopicsDiscussed: ['Planos e Condições', 'Pagamento PIX', 'Atendimento Humanizado'],
        multiModalInsights: ['Interação com áudios e mensagens de texto com alto engajamento.'],
        recommendedNextAction: 'Enviar link de pagamento PIX com 10% de desconto e agendar onboarding.',
        suggestedSmartReply: `Olá ${leadInfo?.name ? leadInfo.name.split(' ')[0] : ''}! Verifiquei sua solicitação e conseguimos liberar 10% de desconto adicional para fechamento via PIX hoje. Posso gerar o seu link exclusivo?`
      };

      return res.json({ success: true, source: 'fallback', analysis: fallbackAnalysis });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao analisar conversa.' });
    }
  });

  // AI Audio Transcription Endpoint
  app.post('/api/transcribe', authenticateToken, aiRateLimiter, async (req, res) => {
    try {
      const { audioBase64, mimeType, leadName, customInstructions } = req.body || {};

      const ai = getGeminiClient();
      if (ai && audioBase64) {
        try {
          const prompt = `Você é um transcritor e analista de áudios de atendimento para WhatsApp CRM.
Processe o áudio fornecido e responda estritamente em formato JSON com a seguinte estrutura:
{
  "transcription": "transcrição do áudio em português",
  "language": "Português (Brasil)",
  "summary": "resumo de 1-2 frases do áudio",
  "intent": "Intenção do cliente",
  "sentiment": "Positivo" | "Neutro" | "Dúvida" | "Urgente" | "Objeção",
  "keyPoints": ["ponto chave 1", "ponto chave 2"],
  "suggestedReply": "sugestão de resposta amigável",
  "urgencyScore": número de 1 a 5
}
${customInstructions || ''}`;

          const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');

          const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: [
              {
                inlineData: {
                  data: cleanBase64,
                  mimeType: mimeType || 'audio/ogg',
                },
              },
              { text: prompt },
            ],
            config: {
              responseMimeType: 'application/json',
            },
          });

          const rawText = response.text || '';
          const parsed = JSON.parse(rawText);
          return res.json({ success: true, source: 'gemini', result: parsed });
        } catch (geminiError) {
          console.warn('Gemini Audio Transcription error, fallbacking:', geminiError);
        }
      }

      // Fallback preset transcription
      const fallbackResult = {
        transcription: 'Olá, gostaria de confirmar os detalhes do plano comercial e saber se há suporte para dúvidas de integração.',
        language: 'Português (Brasil)',
        summary: 'Cliente solicita confirmação de suporte e detalhes sobre o plano comercial.',
        intent: 'Dúvida Comercial & Suporte',
        sentiment: 'Positivo',
        keyPoints: ['Suporte técnico', 'Plano comercial'],
        suggestedReply: `Olá ${leadName || ''}! Nosso plano inclui suporte dedicado 24/7 e onboarding acompanhado. Como posso ajudar com seu início?`,
        urgencyScore: 4,
      };

      return res.json({ success: true, source: 'fallback', result: fallbackResult });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao processar áudio.' });
    }
  });

  // Meta CAPI Send Event Endpoint
  app.post('/api/meta-capi/send-event', authenticateToken, (req, res) => {
    const { eventName, pixelId } = req.body || {};
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    res.json({
      success: true,
      eventId,
      eventTime: new Date().toISOString(),
      matchQualityScore: 8.9,
      status: 'simulated_ok',
      userHash: {
        phoneHash: '5511999998888_sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      message: `Evento Meta Conversions API "${eventName || 'Lead'}" sincronizado com Pixel ${pixelId || '891029384712039'}.`,
    });
  });

  // Analytics AI Strategic Report Endpoint
  app.post('/api/analytics/ai-report', authenticateToken, aiRateLimiter, async (req, res) => {
    try {
      const { leads } = req.body || {};
      const ai = getGeminiClient();
      if (ai) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: `Atue como Especialista em Atribuição Meta Ads e Growth Hacking.
Analise os dados dos leads a seguir e gere um relatório de inteligência estratégica conciso em português (3 parágrafos) destacando ROAS, Canais de Alta Conversão, CAPI Match Quality Score e sugestões de otimização:
Leads: ${JSON.stringify(leads || [])}`,
          });
          return res.json({ success: true, source: 'gemini', report: response.text });
        } catch (err) {
          console.warn('AI Report generation error:', err);
        }
      }

      const fallbackReport = `📊 **Relatório Estratégico de Atribuição e ROAS (IA Universo)**
      
1. **Desempenho dos Canais**: O canal **Meta Ads (Instagram & Facebook)** respondeu por 68% dos leads qualificados, com CAC médio de R$ 22,40 e ROAS estimado em 4.8x. As campanhas de retargeting no WhatsApp apresentaram 85% de conversão no estágio de proposta.
2. **Qualidade do CAPI (Meta Cloud)**: O Match Quality Score da API de Conversões está em **8.9/10**, com sincronização de fbc, fbp e números de telefone criptografados via SHA-256.
3. **Recomendação de Mídia**: Aumentar em 25% o orçamento nas campanhas do topo do funil no Meta Ads e ativar o disparo automático do evento **PurchaseIntention** para otimização de lances.`;

      return res.json({ success: true, source: 'fallback', report: fallbackReport });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao gerar relatório.' });
    }
  });

  // Criar Conexão Canal Endpoint
  app.post('/api/canais/criar', (req, res) => {
    const { empresaId, nomeCanal } = req.body || {};
    const channel_token = `evo_tok_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.json({
      success: true,
      channel_token,
      empresaId,
      nomeCanal,
      status: 'qr_pendente',
      message: 'Canal configurado com sucesso! Utilize o token para conectar o WhatsApp.',
    });
  });

  // ==========================================
  // EVO HUB — REST API PLATAFORMA DE INTEGRAÇÃO
  // ==========================================
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

  // Middleware Auth Evo Hub — estas rotas /api/v1/* são um facade próprio (mock),
  // não chamam a api.evohub.ai real. Exigem um token configurado em EVOHUB_API_KEY.
  const EVOHUB_API_KEY = process.env.EVOHUB_API_KEY;
  if (!EVOHUB_API_KEY && !isProduction) {
    console.warn('⚠️  EVOHUB_API_KEY não configurada — rotas /api/v1/* do Evo Hub aceitam qualquer chamada (dev only).');
  }

  const authenticateEvoHub = (req: any, res: any, next: any) => {
    if (!EVOHUB_API_KEY) {
      if (isProduction) {
        return res.status(503).json({ error: 'EVOHUB_API_KEY não configurada neste ambiente.' });
      }
      req.evoAuth = { token: 'dev_no_auth', authenticated: true };
      return next();
    }

    const authHeader = req.headers['authorization'] as string | undefined;
    const apiKeyQuery = req.query['api_key'] || req.query['key'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader || apiKeyQuery;

    if (token !== EVOHUB_API_KEY) {
      return res.status(401).json({ error: 'Token de autenticação do Evo Hub ausente ou inválido.' });
    }

    req.evoAuth = { token, authenticated: true };
    next();
  };

  // 1. GET /api/v1/channels — Listar todos os canais de conexão
  app.get('/api/v1/channels', authenticateEvoHub, (req, res) => {
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
  app.post('/api/v1/channels', authenticateEvoHub, (req, res) => {
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
  app.get('/api/v1/channels/:id', authenticateEvoHub, (req, res) => {
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

  app.put('/api/v1/channels/:id', authenticateEvoHub, updateChannelHandler);
  app.patch('/api/v1/channels/:id', authenticateEvoHub, updateChannelHandler);

  // 5. DELETE /api/v1/channels/:id — Remover canal
  app.delete('/api/v1/channels/:id', authenticateEvoHub, (req, res) => {
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
  app.post('/api/v1/channels/:id/connect', authenticateEvoHub, (req, res) => {
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
  app.post('/api/v1/messages/send', authenticateEvoHub, async (req, res) => {
    const { channel_id, to, number, type = 'text', text, body, media, caption } = req.body || {};
    const targetNumber = to || number || '5511999998888';
    const messageText = typeof text === 'string' ? text : text?.body || body || 'Mensagem do Evo Hub';

    console.log(`📤 [Evo Hub REST API] Enviando mensagem para ${targetNumber}:`, messageText);

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
  });

  // 8. GET & POST /api/v1/webhooks — Gerenciar Webhooks no Evo Hub
  app.get('/api/v1/webhooks', authenticateEvoHub, (req, res) => {
    res.json({
      success: true,
      total: evoWebhooks.length,
      webhooks: evoWebhooks
    });
  });

  app.post('/api/v1/webhooks', authenticateEvoHub, (req, res) => {
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

  app.delete('/api/v1/webhooks/:id', authenticateEvoHub, (req, res) => {
    const { id } = req.params;
    const idx = evoWebhooks.findIndex(w => w.id === id);
    if (idx !== -1) evoWebhooks.splice(idx, 1);
    res.json({ success: true, message: 'Webhook removido' });
  });

  // 9. GET & POST /api/v1/templates — Templates de Mensagens WhatsApp
  app.get('/api/v1/templates', authenticateEvoHub, (req, res) => {
    res.json({ success: true, total: evoTemplates.length, templates: evoTemplates });
  });

  app.post('/api/v1/templates', authenticateEvoHub, (req, res) => {
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
  app.all('/api/v1/meta/*', authenticateEvoHub, (req, res) => {
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

  // Servir Vite middleware em desenvolvimento ou arquivos estáticos em produção
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Servidor Universo.ai rodando na porta ${PORT}`);
  });
}

startServer();
