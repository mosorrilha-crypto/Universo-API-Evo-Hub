import { Router, type RequestHandler } from 'express';
import type { ServerConfig } from '../config';
import { getGeminiClient, withGeminiRetry } from '../gemini';
import { transcribeAudioWithGemini } from '../services/geminiTranscription';

interface AiRouterDeps {
  config: ServerConfig;
  authenticateToken: RequestHandler;
  rateLimiter: RequestHandler;
}

export function createAiRouter({ config, authenticateToken, rateLimiter }: AiRouterDeps): Router {
  const router = Router();
  const ai = getGeminiClient(config);

  // ✅ Endpoint de teste do Gemini
  router.get('/api/test-gemini', authenticateToken, rateLimiter, async (req, res) => {
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

  // AI Conversation Analysis Endpoint
  router.post('/api/analyze-conversation', authenticateToken, rateLimiter, async (req, res) => {
    try {
      const { leadInfo, messages, agentKnowledgeBase } = req.body || {};

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
  "suggestedSmartReply": "resposta inteligente pronta e persuasiva para o operador enviar, escrita no MESMO idioma do lead (detectedLanguage)",
  "suggestedSmartReplyTranslation": "tradução literal de suggestedSmartReply para o Português, SOMENTE se detectedLanguage não for português — se já for português, use string vazia"
}

Dados do Lead: ${JSON.stringify(leadInfo)}
Histórico de Mensagens: ${JSON.stringify(messages)}
Base de Conhecimento: ${JSON.stringify(agentKnowledgeBase || {})}
`;

          // Issue #94 — confirmado nos logs do Render: essa chamada não tinha
          // nenhuma tentativa extra, então uma falha transitória do Gemini
          // (503 "high demand", timeout) caía direto no fallback na 1ª
          // tentativa — mesma causa raiz já corrigida em autoReply.ts (#84),
          // helper compartilhado agora em server/gemini.ts.
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
            },
          }));

          const rawText = response.text || '';
          const parsed = JSON.parse(rawText);
          return res.json({ success: true, source: 'gemini', analysis: parsed });
        } catch (geminiError) {
          console.warn('Gemini API call error, fallbacking to preset analysis:', geminiError);
        }
      }

      // Achado numa auditoria pós-lançamento: esse fallback inventava dados de
      // vendas fictícios (orçamento, objeções, "10% de desconto via PIX" —
      // PIX nem existe no Paraguai) e uma resposta pronta pra enviar direto
      // no WhatsApp, sem nenhum aviso pro operador de que não era uma análise
      // real. Se o operador clicasse "Enviar esta resposta", um desconto
      // inventado e sem autorização ia pro cliente de verdade. Um lead real
      // (595981828280) chegou a ativar exatamente esse fallback e mostrou o
      // texto fabricado como se fosse análise de IA. Agora o fallback nunca
      // inventa números/promessas — só reporta que a análise não pôde ser
      // gerada, com o `source: 'fallback'` que o frontend usa pra avisar o
      // operador visivelmente.
      const msgCount = Array.isArray(messages) ? messages.length : 0;

      const fallbackAnalysis = {
        leadStage: 'contato',
        dealProbability: 0,
        overallSentiment: 'Neutro',
        urgencyLevel: 0,
        detectedLanguage: undefined,
        conversationSummary: `Não foi possível gerar a análise de IA agora (${msgCount} mensagem(ns) na conversa). Tente novamente em instantes — nenhum dado abaixo é real.`,
        extractedCRMData: {
          budget: 'Não disponível',
          timeline: 'Não disponível',
          productsOfInterest: [],
          keyObjections: [],
          decisionCriteria: 'Não disponível',
        },
        keyTopicsDiscussed: [],
        multiModalInsights: [],
        recommendedNextAction: 'Análise indisponível no momento — revise a conversa manualmente antes de responder.',
        suggestedSmartReply: '',
        suggestedSmartReplyTranslation: '',
      };

      return res.json({ success: true, source: 'fallback', analysis: fallbackAnalysis });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao analisar conversa.' });
    }
  });

  // AI Audio Transcription Endpoint
  router.post('/api/transcribe', authenticateToken, rateLimiter, async (req, res) => {
    try {
      const { audioBase64, mimeType, leadName, customInstructions } = req.body || {};
      const outcome = await transcribeAudioWithGemini(ai, audioBase64, mimeType, { leadName, customInstructions });
      return res.json({ success: true, source: outcome.source, result: outcome.result });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao processar áudio.' });
    }
  });

  // Analytics AI Strategic Report Endpoint
  router.post('/api/analytics/ai-report', authenticateToken, rateLimiter, async (req, res) => {
    try {
      const { leads } = req.body || {};
      if (ai) {
        try {
          // Mesmo achado do endpoint /api/analyze-conversation acima (issue #94).
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: `Atue como Especialista em Atribuição Meta Ads e Growth Hacking.
Analise os dados dos leads a seguir e gere um relatório de inteligência estratégica conciso em português (3 parágrafos) destacando ROAS, Canais de Alta Conversão, CAPI Match Quality Score e sugestões de otimização:
Leads: ${JSON.stringify(leads || [])}`,
          }));
          return res.json({ success: true, source: 'gemini', report: response.text });
        } catch (err) {
          console.warn('AI Report generation error:', err);
        }
      }

      // Achado numa auditoria externa, mesma classe de bug já corrigida em
      // /api/analyze-conversation: quando o Gemini falhava, esse fallback
      // inventava métricas de negócio inteiras (68% dos leads via Meta Ads,
      // CAC R$ 22,40, ROAS 4.8x, Match Quality Score 8.9/10) e ATÉ uma
      // recomendação de aumentar orçamento em 25% — apresentado como se
      // fosse um relatório real da "IA Universo", sem nenhum aviso de que
      // era fabricado. Um operador poderia tomar decisão de investimento
      // real em cima de números que nunca existiram. Agora o fallback nunca
      // inventa números — só reporta que não pôde gerar, com `source:
      // 'fallback'` pro frontend avisar visivelmente.
      const fallbackReport = `⚠️ Não foi possível gerar o relatório de IA agora (Gemini indisponível). Tente novamente em instantes — nenhum dado abaixo é real.`;

      return res.json({ success: true, source: 'fallback', report: fallbackReport });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao gerar relatório.' });
    }
  });

  return router;
}
