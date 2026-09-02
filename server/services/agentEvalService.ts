import { randomUUID } from 'crypto';
import type { GoogleGenAI } from '@google/genai';
import { withGeminiRetry } from '../gemini';
import { formatKnowledgeBaseForPrompt, getRuntimeKnowledgeBase, type AgentKnowledgeBase } from './knowledgeBaseStore';
import { getTenantSegment } from './tenantProfileStore';
import { generateAutoReplyForText, type AgentType } from './autoReply';
import { reviewAutoReplyBeforeSend, type ReplySafetyVerdict } from './replySafetyGate';
import { createQualityReview } from './qualityAuditStore';

/**
 * TASK-0203 — pedido direto do dono do produto: usar um "robô" pra gerar
 * perguntas reais pro agente, avaliar as respostas e alimentar a correção,
 * em vez de depender só de escalonamentos reais de produção pra achar
 * classe de bug (o jeito que este projeto vinha achando problema até aqui —
 * ver TASK-0193, achado via print de conversa real).
 *
 * Deliberadamente NÃO auto-corrige nada sozinho: gera evidência (achado
 * sintético + sugestão) e cai na Central de Qualidade (`qualityAuditStore`)
 * pra revisão humana — mesmo padrão já usado pelo resto do projeto pra
 * qualquer coisa que possa mudar o comportamento do agente (ver
 * "Aprovar e enviar rascunho bloqueado" em docs/GUIA-DO-PROJETO.md). Uma IA
 * decidindo sozinha que a própria resposta está errada e reescrevendo a
 * Base de Conhecimento ou o prompt sem revisão é exatamente o tipo de risco
 * que este projeto evita em todo canto (agenda, pagamento, CRM).
 *
 * Usa gemini-3.5-flash-lite pra geração/julgamento (mesmo motivo já
 * documentado em server/routes/ai.ts: são chamadas AUXILIARES, cota
 * separada da que o pipeline real do agente usa) — só a resposta sendo
 * avaliada roda no pipeline de verdade (generateAutoReplyForText, chamado
 * pelo script, não por este arquivo).
 */
const EVAL_MODEL = 'gemini-3.5-flash-lite';
const GENERATION_BATCH_SIZE = 20;

export type EvalQuestionCategory = 'triagem' | 'faq' | 'agendamento' | 'reclamacao' | 'repeticao' | 'idioma' | 'ambiguo';

export interface SyntheticEvalCase {
  category: EvalQuestionCategory;
  text: string;
  /** Só usado por casos "repeticao"/"idioma" que precisam de contexto prévio pra fazer sentido testar. */
  history?: { sender: 'lead' | 'agent'; text: string }[];
  /** O que este caso testa, curto — vira parte da descrição do achado se falhar. */
  note: string;
}

function buildGenerationPrompt(kbContext: string, count: number, offset: number): string {
  return `Você gera casos de teste REALISTAS pra avaliar um atendente de WhatsApp por IA de um negócio real. Cada caso é uma mensagem que um CLIENTE de verdade mandaria — curta, informal, no idioma que faria sentido pro público real do negócio (a Base de Conhecimento abaixo diz qual), às vezes com erro de digitação ou frase incompleta, nunca formal ou artificial.

Gere exatamente ${count} casos NOVOS e VARIADOS (lote começando no índice ${offset} — não repita ideia de lote anterior). Distribua entre estas categorias, cobrindo várias:
- "triagem": primeiro contato, curiosidade, ainda sem pedir nada específico.
- "faq": pergunta direta sobre preço, duração, procedimento, localização ou pagamento.
- "agendamento": quer marcar, remarcar ou cancelar um horário.
- "reclamacao": insatisfação ou problema real (não elogio).
- "repeticao": a cliente pergunta de novo algo que JÁ foi respondido no "history" deste caso — testa se o atendente repete a mesma informação ou se apresenta de novo, quando não devia.
- "idioma": mistura dois idiomas na mesma mensagem, ou muda de idioma no meio de uma frase.
- "ambiguo": menciona um serviço de forma vaga ou com nome que não bate exatamente com nenhum item do catálogo — testa se o atendente pede esclarecimento em vez de adivinhar.

Regras obrigatórias:
- SÓ mencione serviço, preço ou detalhe que apareça de verdade na BASE DE CONHECIMENTO abaixo — nunca invente algo que não está nela (isso invalidaria o teste).
- Para "repeticao", preencha "history" com exatamente 2 mensagens anteriores: uma da cliente perguntando algo real do catálogo, uma do atendente respondendo corretamente — e "text" repete a mesma pergunta (ou uma variação óbvia dela) de novo.
- Pra todas as outras categorias, "history" pode ficar vazio (array vazio) — a maioria dos casos deve ser conversa nova, sem histórico.

BASE DE CONHECIMENTO:
${kbContext || '[nenhuma base de conhecimento configurada pra este tenant]'}

Responda ESTRITAMENTE em JSON, sem nenhum texto fora do JSON:
{"cases":[{"category":"triagem|faq|agendamento|reclamacao|repeticao|idioma|ambiguo","text":"mensagem do cliente","note":"o que este caso testa, uma frase curta","history":[{"sender":"lead","text":"..."},{"sender":"agent","text":"..."}]}]}`;
}

const VALID_CATEGORIES: EvalQuestionCategory[] = ['triagem', 'faq', 'agendamento', 'reclamacao', 'repeticao', 'idioma', 'ambiguo'];

/** Exportado só pra teste direto do parser sem precisar mockar o Gemini pra cada formato de resposta possível. */
export function parseGeneratedCases(raw: unknown): SyntheticEvalCase[] {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const list = Array.isArray(data.cases) ? data.cases : [];
  return list
    .map((item): SyntheticEvalCase | null => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      const category = VALID_CATEGORIES.includes(entry.category as EvalQuestionCategory) ? entry.category as EvalQuestionCategory : null;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!category || !text) return null;
      const note = typeof entry.note === 'string' ? entry.note.trim() : '';
      const historyRaw = Array.isArray(entry.history) ? entry.history : [];
      const history = historyRaw
        .map((h) => {
          if (!h || typeof h !== 'object') return null;
          const he = h as Record<string, unknown>;
          const sender = he.sender === 'agent' ? 'agent' as const : he.sender === 'lead' ? 'lead' as const : null;
          const hText = typeof he.text === 'string' ? he.text.trim() : '';
          if (!sender || !hText) return null;
          return { sender, text: hText };
        })
        .filter((h): h is { sender: 'lead' | 'agent'; text: string } => h !== null);
      return { category, text, note, history: history.length ? history : undefined };
    })
    .filter((c): c is SyntheticEvalCase => c !== null);
}

/** Gera `count` casos sintéticos grounded na Base de Conhecimento real do tenant, em lotes (evita truncar uma resposta JSON gigante numa única chamada). */
export async function generateSyntheticEvalQuestions(ai: GoogleGenAI, kb: AgentKnowledgeBase | null, count: number): Promise<SyntheticEvalCase[]> {
  const kbContext = formatKnowledgeBaseForPrompt(kb);
  const cases: SyntheticEvalCase[] = [];
  while (cases.length < count) {
    const batchCount = Math.min(GENERATION_BATCH_SIZE, count - cases.length);
    const prompt = buildGenerationPrompt(kbContext, batchCount, cases.length);
    const response = await withGeminiRetry(() => ai.models.generateContent({
      model: EVAL_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    }));
    const parsed = parseGeneratedCases(JSON.parse(response.text || '{}'));
    if (!parsed.length) break; // evita loop infinito se o modelo devolver vazio repetidamente
    cases.push(...parsed);
  }
  return cases.slice(0, count);
}

export interface QualityJudgeVerdict {
  passed: boolean;
  issues: string[];
  /** Sugestão curta de como a resposta deveria ter sido — só quando reprovado. */
  suggestedFix?: string;
}

function buildJudgePrompt(input: { customerMessage: string; history?: { sender: string; text: string }[]; bubbles: string[] }): string {
  const history = (input.history || [])
    .map((m) => `${m.sender === 'lead' ? 'CLIENTE' : 'ATENDENTE'}: ${m.text}`)
    .join('\n');
  return `Você é um avaliador de qualidade de atendimento de WhatsApp por IA. Julgue SÓ o estilo/naturalidade da resposta abaixo — não julgue se o preço/dado está certo (isso já é responsabilidade de outro revisor).

Reprove se encontrar QUALQUER um destes problemas reais (acontecidos de verdade em produção neste projeto):
1. Se reapresentar ou cumprimentar ("¡Hola!", "Olá!") quando o histórico mostra que já se falaram.
2. Repetir uma informação (preço, prazo, condição) que já apareceu no histórico do ATENDENTE, como se fosse a primeira vez.
3. Repetir uma pergunta que a cliente já respondeu no histórico.
4. Abrir a mensagem com uma interjeição de entusiasmo genérica ("¡Dale!", "¡Genial!", "¡Perfecto!", "Ótimo!") quando o conteúdo é neutro/transacional.
5. Soar robótico, formal demais, ou como script decorado em vez de conversa natural.
6. Ignorar uma pergunta direta e específica da última mensagem do cliente.
7. Misturar dois idiomas na mesma frase (nunca português dentro de uma frase em espanhol ou vice-versa).

Responda ESTRITAMENTE em JSON: {"passed":boolean,"issues":["problema encontrado, curto"],"suggestedFix":"como a resposta deveria ter sido, só se passed=false, senão string vazia"}

HISTÓRICO ANTERIOR:
${history || '[sem histórico — primeiro contato]'}

MENSAGEM DO CLIENTE AVALIADA:
${input.customerMessage}

RESPOSTA DO ATENDENTE A AVALIAR:
${input.bubbles.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
}

/** Exportado só pra teste direto do parser. */
export function parseJudgeVerdict(raw: unknown): QualityJudgeVerdict {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const passed = data.passed === true;
  const issues = Array.isArray(data.issues) ? data.issues.filter((i): i is string => typeof i === 'string' && i.trim().length > 0) : [];
  const suggestedFix = typeof data.suggestedFix === 'string' && data.suggestedFix.trim() ? data.suggestedFix.trim() : undefined;
  return { passed: passed && issues.length === 0, issues, suggestedFix };
}

export async function judgeAgentReplyQuality(ai: GoogleGenAI, input: { customerMessage: string; history?: { sender: string; text: string }[]; bubbles: string[] }): Promise<QualityJudgeVerdict> {
  const prompt = buildJudgePrompt(input);
  const response = await withGeminiRetry(() => ai.models.generateContent({
    model: EVAL_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  }));
  return parseJudgeVerdict(JSON.parse(response.text || '{}'));
}

/**
 * Achado real de produção que motivou a regra 12 do REGRAS DE ESTILO
 * (autoReply.ts): a mesma frase pronta aparecendo em várias conversas
 * diferentes é um dos jeitos mais fáceis de um cliente perceber que está
 * falando com um robô. Sem custo de IA nenhum: normaliza cada bolha gerada
 * no lote inteiro e conta repetição quase-verbatim entre CASOS DIFERENTES
 * (nunca dentro do mesmo caso — bolhas da mesma resposta sempre repetem
 * palavras entre si por design).
 */
export function findRepeatedPhrasesAcrossResponses(
  cases: { bubbles: string[] }[],
  minOccurrences = 3
): { phrase: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    const normalizedInThisCase = new Set(c.bubbles.map(normalizeForRepetitionCheck).filter((b) => b.length >= 20));
    for (const normalized of normalizedInThisCase) {
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= minOccurrences)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count);
}

function normalizeForRepetitionCheck(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export interface AgentEvalCaseResult extends SyntheticEvalCase {
  agent?: AgentType;
  bubbles?: string[];
  safety?: ReplySafetyVerdict;
  quality?: QualityJudgeVerdict;
  passed?: boolean;
  error?: string;
}

export interface AgentEvalRunSummary {
  total: number;
  passed: number;
  failed: number;
  createdReviewCount: number;
  repeatedPhrases: { phrase: string; count: number }[];
}

/**
 * TASK-0208 — orquestração compartilhada entre `scripts/eval-agent.ts` (CLI)
 * e a rota `POST /api/quality-audit/eval-runs` (botão no painel), pra não
 * duplicar a lógica de "gerar → rodar no pipeline real → avaliar →
 * registrar falha" em dois lugares. `onProgress` existe pra quem chama
 * (rota ou CLI) reportar progresso sem esta função saber COMO (atualiza
 * linha no banco / imprime no terminal); `onCaseResult` existe só pro CLI
 * conseguir salvar o dump completo em `--out`, sem custar nada a quem não
 * usa (a rota do painel não passa isso).
 */
export async function runAgentEvaluation(options: {
  tenantId: string;
  ai: GoogleGenAI;
  count: number;
  groqApiKey?: string;
  onProgress?: (progress: { completed: number; total: number; passed: number; failed: number }) => void | Promise<void>;
  onCaseResult?: (result: AgentEvalCaseResult) => void;
}): Promise<AgentEvalRunSummary> {
  const { tenantId, ai, count, groqApiKey, onProgress, onCaseResult } = options;

  const runtimeKb = await getRuntimeKnowledgeBase(tenantId);
  if (runtimeKb.source === 'unavailable') {
    throw new Error('Base de Conhecimento indisponível pra este tenant — não dá pra gerar casos grounded sem ela.');
  }
  const kb = runtimeKb.knowledgeBase;
  const kbContext = formatKnowledgeBaseForPrompt(kb);
  const segment = await getTenantSegment(tenantId);

  const cases = await generateSyntheticEvalQuestions(ai, kb, count);

  let passed = 0;
  let failed = 0;
  let createdReviewCount = 0;
  const bubblesForRepetitionCheck: { bubbles: string[] }[] = [];

  const reportFailure = async (c: SyntheticEvalCase, extra: { agent?: AgentType; bubbles?: string[]; safety?: ReplySafetyVerdict; quality?: QualityJudgeVerdict; error?: string }) => {
    failed++;
    const issueParts = [
      extra.safety && !extra.safety.approved ? `Revisor de segurança: ${extra.safety.reason}` : null,
      extra.quality?.issues?.length ? `Qualidade: ${extra.quality.issues.join('; ')}` : null,
      extra.error ? `Erro: ${extra.error}` : null,
    ].filter((p): p is string => Boolean(p));
    await createQualityReview({
      tenantId,
      kind: 'bug',
      title: `[Avaliação automática] ${c.category}: falha em caso sintético`,
      description: `Pergunta sintética (${c.note || 'sem nota'}): "${c.text}"\n\nProblema encontrado: ${issueParts.join(' | ') || 'não especificado'}`,
      context: { source: 'synthetic_eval', category: c.category, question: c.text, history: c.history, agent: extra.agent },
      originalValue: extra.bubbles?.join('\n') || null,
      correctedValue: extra.quality?.suggestedFix || null,
    });
    createdReviewCount++;
    onCaseResult?.({ ...c, agent: extra.agent, bubbles: extra.bubbles, safety: extra.safety, quality: extra.quality, error: extra.error, passed: false });
  };

  for (const c of cases) {
    const fakePhone = `eval-${randomUUID()}`;
    let genResult;
    try {
      genResult = await generateAutoReplyForText(
        tenantId, ai, c.text, undefined, kbContext, c.history, fakePhone,
        undefined /* calendarConfig — de propósito ausente, nunca toca a agenda real */,
        segment, undefined, undefined, undefined, undefined, groqApiKey, undefined, false
      );
    } catch (err) {
      await reportFailure(c, { error: (err as Error)?.message || String(err) });
      await onProgress?.({ completed: passed + failed, total: cases.length, passed, failed });
      continue;
    }
    if (!genResult) {
      await reportFailure(c, { error: 'Sem resposta (Gemini indisponível, fallback honesto acionado)' });
      await onProgress?.({ completed: passed + failed, total: cases.length, passed, failed });
      continue;
    }

    const bubbles = genResult.bubbles;
    let safety: ReplySafetyVerdict;
    let quality: QualityJudgeVerdict;
    try {
      [safety, quality] = await Promise.all([
        reviewAutoReplyBeforeSend(
          {
            customerMessage: c.text,
            draftBubbles: bubbles,
            history: c.history,
            knowledgeContext: kbContext,
            isBookingFlow: genResult.agent === 'agendamento',
            needsHumanConfirmation: genResult.needsHumanConfirmation,
          },
          { ai, groqApiKey }
        ),
        judgeAgentReplyQuality(ai, { customerMessage: c.text, history: c.history, bubbles }),
      ]);
    } catch (err) {
      await reportFailure(c, { agent: genResult.agent, bubbles, error: `Falha ao avaliar: ${(err as Error)?.message || err}` });
      await onProgress?.({ completed: passed + failed, total: cases.length, passed, failed });
      continue;
    }

    const isPassed = safety.approved && quality.passed;
    if (isPassed) {
      passed++;
      bubblesForRepetitionCheck.push({ bubbles });
      onCaseResult?.({ ...c, agent: genResult.agent, bubbles, safety, quality, passed: true });
    } else {
      bubblesForRepetitionCheck.push({ bubbles });
      await reportFailure(c, { agent: genResult.agent, bubbles, safety, quality });
    }
    await onProgress?.({ completed: passed + failed, total: cases.length, passed, failed });
  }

  const repeatedPhrases = findRepeatedPhrasesAcrossResponses(bubblesForRepetitionCheck);
  return { total: cases.length, passed, failed, createdReviewCount, repeatedPhrases };
}
