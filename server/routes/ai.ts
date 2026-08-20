import { Router, type RequestHandler } from 'express';
import type { ServerConfig } from '../config';
import { getGeminiClient, withGeminiRetry } from '../gemini';
import { transcribeAudioWithGemini } from '../services/geminiTranscription';
import { callGroqJsonCompletion } from '../services/groqClient';
import { formatKnowledgeBaseForPrompt } from '../services/knowledgeBaseStore';

/**
 * Achado real em produção (18/08/2026): os quatro endpoints deste arquivo
 * (análise contextual, gerar resposta a partir de sugestão, perguntar à
 * IA, relatório estratégico) vinham falhando com 429 RESOURCE_EXHAUSTED —
 * o projeto estourava o teto de 2M tokens/minuto do gemini-3.6-flash
 * (Nível 1), cota compartilhada com o pipeline principal do agente
 * (autoReply.ts, que decide e envia a resposta automática de verdade pro
 * cliente no WhatsApp). Pedido direto do dono do produto: são recursos
 * AUXILIARES da ficha de atendimento (o operador decide se usa, nunca
 * determinam sozinhos o que é enviado ao cliente), então trocados pra
 * gemini-3.5-flash-lite — cota separada de 4M tokens/minuto (o dobro,
 * praticamente sem uso hoje) e ~5x mais barato. autoReply.ts continua em
 * gemini-3.6-flash de propósito — ali sim é a resposta automática real,
 * não vale o mesmo trade-off de qualidade por confiabilidade.
 *
 * Achado real (19/08/2026): mesmo em modelos/cotas diferentes do
 * autoReply.ts, a GEMINI_API_KEY é ÚNICA pro projeto inteiro — a cota de
 * tokens/minuto do gemini-3.5-flash-lite é compartilhada entre TODOS os
 * tenants e TODAS as chamadas que usam esse modelo (Ficha IA de qualquer
 * tenant + relatório de analytics), não é isolada por tenant nem por
 * feature. Pedido direto do dono do produto: mesmo padrão Groq→Gemini já
 * usado no router do autoReply.ts (classifyAgent, ver autoReply.ts),
 * aplicado aqui — Groq é a PRIMEIRA tentativa (mais barata/rápida, cota
 * própria e totalmente separada da conta Gemini), e só cai pro Gemini se o
 * Groq falhar (rede, timeout, JSON malformado, campo esperado ausente).
 * Sem GROQ_API_KEY configurada, o comportamento é 100% o de antes (só
 * Gemini).
 */

/**
 * Achado real (19/08/2026): o 413 "Request Entity Too Large" do Groq batia
 * até na 1ª mensagem de uma conversa NOVA, sem histórico grande nenhum —
 * a causa não era o tamanho da conversa, era `mediaBase64` (imagem/áudio
 * do lead embutido inteiro em base64 dentro de `messages`, ver ChatMessage
 * em src/types.ts) sendo mandado cru no JSON.stringify do prompt. Nenhum
 * dos 3 endpoints aqui pede imagem pro Groq (só texto, response_format
 * json_object) — o base64 nunca era usado, só inflava o payload. Mesmo
 * princípio já aplicado à Base de Conhecimento (formatKnowledgeBaseForPrompt
 * em vez de JSON.stringify cru): manda só o que o texto precisa.
 */
function stripMediaBase64ForPrompt(messages: any): any {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== 'object' || !m.mediaBase64) return m;
    const { mediaBase64, ...rest } = m;
    return rest;
  });
}

interface AiRouterDeps {
  config: ServerConfig;
  authenticateToken: RequestHandler;
  rateLimiter: RequestHandler;
}

export function createAiRouter({ config, authenticateToken, rateLimiter }: AiRouterDeps): Router {
  const router = Router();
  const ai = getGeminiClient(config);
  const groqApiKey = config.groqApiKey;

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
  "suggestedSmartReply": "resposta inteligente pronta e persuasiva para o operador enviar, escrita no MESMO idioma do lead (detectedLanguage) — DEVE executar literalmente o que foi descrito em recommendedNextAction (não é uma resposta independente/genérica, é a implementação em texto daquela ação)",
  "suggestedSmartReplyTranslation": "tradução literal de suggestedSmartReply para o Português, SOMENTE se detectedLanguage não for português — se já for português, use string vazia"
}

IMPORTANTE: se o lead mandou mais de uma mensagem seguida antes de qualquer resposta do operador/agente (rajada), trate todas como uma única pergunta composta — recommendedNextAction e suggestedSmartReply DEVEM responder a TODAS as perguntas/tópicos dessa rajada, não só à primeira ou à mais relevante para a venda. Nunca ignore uma pergunta direta do lead (ex: sobre a empresa, localização, quem está atendendo) só porque outra pergunta na mesma rajada parece comercialmente mais importante.

Dados do Lead: ${JSON.stringify(leadInfo)}
Histórico de Mensagens: ${JSON.stringify(stripMediaBase64ForPrompt(messages))}
Base de Conhecimento: ${formatKnowledgeBaseForPrompt(agentKnowledgeBase || null)}
`;

      if (groqApiKey) {
        try {
          const { parsed } = await callGroqJsonCompletion(groqApiKey, prompt);
          if (!parsed || typeof parsed.leadStage !== 'string') {
            throw new Error(`Groq retornou análise sem "leadStage" válido: ${JSON.stringify(parsed)?.slice(0, 200)}`);
          }
          return res.json({ success: true, source: 'groq', analysis: parsed });
        } catch (groqError) {
          console.warn('⚠️  [Ficha IA] Groq falhou (analyze-conversation), caindo pro Gemini:', (groqError as Error)?.message || groqError);
        }
      }

      if (ai) {
        try {
          // Issue #94 — confirmado nos logs do Render: essa chamada não tinha
          // nenhuma tentativa extra, então uma falha transitória do Gemini
          // (503 "high demand", timeout) caía direto no fallback na 1ª
          // tentativa — mesma causa raiz já corrigida em autoReply.ts (#84),
          // helper compartilhado agora em server/gemini.ts.
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
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

  /**
   * Gera a próxima mensagem pra enviar a partir de uma SUGESTÃO/instrução do
   * operador (pedido real, 15/08/2026: "igual a que temos no escalonamento,
   * mas nesta ficha de IA, pra criar a próxima msg baseada em uma sugestão e
   * não no contexto da conversa" — mesmo espírito do "Orientar a IA" do
   * escalonamento, issue #97, só que aqui a resposta é gerada NA HORA em vez
   * de guardada pra usar só quando o cliente escrever de novo).
   *
   * Diferente do "Resposta Sugerida" de /api/analyze-conversation (que só
   * reage ao histórico), aqui a instrução do operador é o que MANDA — o
   * histórico entra só pra manter tom/idioma/contexto consistentes, nunca
   * pra sobrepor o que o operador pediu.
   */
  router.post('/api/ai/reply-from-hint', authenticateToken, rateLimiter, async (req, res) => {
    try {
      const { leadInfo, messages, agentKnowledgeBase, hint } = req.body || {};
      if (typeof hint !== 'string' || !hint.trim()) {
        return res.status(400).json({ success: false, error: 'Campo "hint" (sua sugestão) é obrigatório.' });
      }

      const prompt = `Você é um atendente de vendas humano respondendo no WhatsApp em nome de um negócio real.
Um operador humano te deu a seguinte instrução sobre o que responder ao lead a seguir — ela é a fonte principal do que escrever, não uma sugestão opcional:
INSTRUÇÃO DO OPERADOR: "${hint.trim()}"

Use o histórico da conversa e a base de conhecimento SÓ pra manter o tom, o idioma e o contexto consistentes com o que já foi dito — nunca pra contrariar ou ignorar a instrução do operador.

Responda estritamente em formato JSON:
{
  "reply": "mensagem pronta pra enviar ao lead, seguindo a instrução do operador, no MESMO idioma que o lead usa na conversa",
  "detectedLanguage": "idioma do lead na conversa, ex: Espanhol (Paraguai)",
  "translation": "tradução literal de reply para o Português, SOMENTE se detectedLanguage não for português — se já for português, use string vazia"
}

Dados do Lead: ${JSON.stringify(leadInfo)}
Histórico de Mensagens: ${JSON.stringify(stripMediaBase64ForPrompt(messages))}
Base de Conhecimento: ${formatKnowledgeBaseForPrompt(agentKnowledgeBase || null)}
`;

      if (groqApiKey) {
        try {
          const { parsed } = await callGroqJsonCompletion(groqApiKey, prompt);
          if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
            throw new Error(`Groq retornou "reply" ausente ou vazio: ${JSON.stringify(parsed)?.slice(0, 200)}`);
          }
          return res.json({ success: true, source: 'groq', ...parsed });
        } catch (groqError) {
          console.warn('⚠️  [Ficha IA] Groq falhou (reply-from-hint), caindo pro Gemini:', (groqError as Error)?.message || groqError);
        }
      }

      if (ai) {
        try {
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: prompt,
            config: { responseMimeType: 'application/json' },
          }));

          const parsed = JSON.parse(response.text || '');
          return res.json({ success: true, source: 'gemini', ...parsed });
        } catch (geminiError) {
          console.warn('Gemini API call error (reply-from-hint), fallbacking:', geminiError);
        }
      }

      // Mesma política anti-fabricação do /api/analyze-conversation acima —
      // nunca inventar uma resposta pronta pra enviar quando o Gemini falha.
      return res.json({
        success: true,
        source: 'fallback',
        reply: '',
        detectedLanguage: undefined,
        translation: '',
        error: 'Não foi possível gerar a resposta agora (Gemini indisponível). Tente novamente em instantes.',
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao gerar resposta a partir da sugestão.' });
    }
  });

  /**
   * Assistente de IA de perguntas livres dentro da Ficha IA (pedido real,
   * 15/08/2026): pode responder tanto sobre ESTA conversa específica ("esse
   * cliente já falou de orçamento antes?") quanto perguntas gerais sem
   * relação nenhuma com o lead ("traduza esta frase", "quais feriados tem
   * este mês") — um assistente pessoal dentro do painel, não travado ao
   * contexto da conversa.
   */
  router.post('/api/ai/ask', authenticateToken, rateLimiter, async (req, res) => {
    try {
      const { leadInfo, messages, question } = req.body || {};
      if (typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ success: false, error: 'Campo "question" é obrigatório.' });
      }

      const prompt = `Você é um assistente de IA dentro do painel de atendimento de um operador de WhatsApp Business.
O operador pode perguntar sobre a conversa com o lead abaixo (ex: "esse cliente já falou de orçamento?", "resume o que falta pra fechar") OU fazer uma pergunta geral sem relação nenhuma com essa conversa (ex: traduções, datas, cálculos, feriados) — responda da forma mais direta e útil possível, em Português, a menos que a pergunta peça outro idioma.

Dados do Lead (contexto, use se for relevante pra pergunta): ${JSON.stringify(leadInfo || {})}
Histórico da Conversa (contexto, use se for relevante pra pergunta): ${JSON.stringify(stripMediaBase64ForPrompt(messages || []))}

Pergunta do operador: "${question.trim()}"

Responda estritamente em formato JSON: { "answer": "sua resposta direta" }`;

      if (groqApiKey) {
        try {
          const { parsed } = await callGroqJsonCompletion(groqApiKey, prompt);
          if (!parsed || typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
            throw new Error(`Groq retornou "answer" ausente ou vazio: ${JSON.stringify(parsed)?.slice(0, 200)}`);
          }
          return res.json({ success: true, source: 'groq', answer: parsed.answer });
        } catch (groqError) {
          console.warn('⚠️  [Ficha IA] Groq falhou (ask), caindo pro Gemini:', (groqError as Error)?.message || groqError);
        }
      }

      if (ai) {
        try {
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: prompt,
            config: { responseMimeType: 'application/json' },
          }));

          const parsed = JSON.parse(response.text || '');
          return res.json({ success: true, source: 'gemini', answer: parsed.answer || '' });
        } catch (geminiError) {
          console.warn('Gemini API call error (ask), fallbacking:', geminiError);
        }
      }

      return res.json({
        success: true,
        source: 'fallback',
        answer: '',
        error: 'Não foi possível consultar a IA agora (Gemini indisponível). Tente novamente em instantes.',
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || 'Erro ao consultar a IA.' });
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
      const reportInstructions = `Atue como Especialista em Atribuição Meta Ads e Growth Hacking.
Analise os dados dos leads a seguir e gere um relatório de inteligência estratégica conciso em português (3 parágrafos) destacando ROAS, Canais de Alta Conversão, CAPI Match Quality Score e sugestões de otimização:
Leads: ${JSON.stringify(leads || [])}`;

      if (groqApiKey) {
        try {
          const { parsed } = await callGroqJsonCompletion(
            groqApiKey,
            `${reportInstructions}\n\nResponda estritamente em formato JSON: { "report": "o relatório completo em texto" }`
          );
          if (!parsed || typeof parsed.report !== 'string' || !parsed.report.trim()) {
            throw new Error(`Groq retornou "report" ausente ou vazio: ${JSON.stringify(parsed)?.slice(0, 200)}`);
          }
          return res.json({ success: true, source: 'groq', report: parsed.report });
        } catch (groqError) {
          console.warn('⚠️  [Ficha IA] Groq falhou (ai-report), caindo pro Gemini:', (groqError as Error)?.message || groqError);
        }
      }

      if (ai) {
        try {
          // Mesmo achado do endpoint /api/analyze-conversation acima (issue #94).
          const response = await withGeminiRetry(() => ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: reportInstructions,
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
