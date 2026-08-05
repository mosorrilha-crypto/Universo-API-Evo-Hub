import type { GoogleGenAI } from '@google/genai';

const GEMINI_TIMEOUT_MS = 20000;

export type ConversationPhase = 'abertura' | 'informacao' | 'objecao' | 'fechamento';
export type AgentType = 'triagem' | 'faq' | 'agendamento';

export interface AutoReplyResult {
  phase: ConversationPhase;
  bubbles: string[];
  agent: AgentType;
  /** true quando o cliente está tentando efetivamente fechar/confirmar um horário — como ainda não temos agendamento real conectado, isso deve virar escalonamento pra humano. */
  needsHumanConfirmation: boolean;
  /** ms gastos na chamada de roteamento — usado pra descontar do atraso de digitação da 1ª bolha, compensando a latência extra do router. */
  routerElapsedMs: number;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini demorou mais de ${ms}ms — abortando.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function buildHistoryText(history?: { sender: 'lead' | 'agent'; text?: string }[]): string {
  return (history || [])
    .filter((m) => m.text)
    .slice(-10)
    .map((m) => `${m.sender === 'lead' ? 'Cliente' : 'Atendente'}: ${m.text}`)
    .join('\n');
}

/**
 * Router leve: classifica qual agente especializado deve atender este turno,
 * ANTES de gastar tokens/latência gerando a resposta de verdade. Isso é o
 * "portão" que, quando o Agendamento real (Google Calendar) existir, decide
 * quando as ferramentas de agenda entram no prompt — sem isso, toda mensagem
 * (até "quanto custa?") carregaria ferramentas de agenda à toa, arriscando o
 * modelo tentar agendar por engano.
 */
async function classifyAgent(ai: GoogleGenAI, text: string, history?: { sender: 'lead' | 'agent'; text?: string }[]): Promise<AgentType> {
  const historyText = buildHistoryText(history);
  const prompt = `Classifique a intenção principal desta mensagem de WhatsApp em UMA categoria:
- "triagem": primeiro contato, saudação, dúvida geral ainda sem foco claro, ou o cliente só está explorando.
- "faq": pergunta específica sobre preço, procedimento, horário de funcionamento, política de pagamento/cancelamento.
- "agendamento": o cliente quer marcar, confirmar, remarcar ou cancelar um horário específico.
${historyText ? `Histórico recente:\n${historyText}\n` : ''}
Mensagem: "${text}"
Responda ESTRITAMENTE em JSON: {"agent": "triagem|faq|agendamento"}`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json' },
    }),
    GEMINI_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}') as { agent?: string };
  const valid: AgentType[] = ['triagem', 'faq', 'agendamento'];
  return valid.includes(parsed.agent as AgentType) ? (parsed.agent as AgentType) : 'triagem';
}

const AGENT_INSTRUCTIONS: Record<AgentType, string> = {
  triagem: `Seu papel agora é TRIAGEM: acolher, criar rapport genuíno, e entender o que o cliente precisa antes de despachar informação. Faça perguntas abertas. Não dispare preço nem catálogo inteiro de uma vez — só o suficiente pra continuar o diálogo.`,
  faq: `Seu papel agora é FAQ/ESPECIALISTA: responda a dúvida específica (preço, procedimento, política) com precisão total usando SOMENTE o contexto do negócio abaixo. Se não tiver o dado exato, diga que vai confirmar — nunca invente.`,
  agendamento: `Seu papel agora é AGENDAMENTO: o cliente quer marcar/confirmar/remarcar um horário. Ainda NÃO temos acesso automático à agenda real — então acolha com entusiasmo, confirme os dados que puder (nome, dia/horário desejado), e avise com carinho que vai confirmar a disponibilidade e retornar em breve (nunca prometa um horário como certo). Marque needsHumanConfirmation como true sempre que o cliente já deu detalhes suficientes pra tentar fechar (nome + dia/horário), pra alguém da equipe confirmar de verdade.`,
};

/**
 * Gera a resposta do agente especializado (já escolhido pelo router acima),
 * fracionada em "bolhas" curtas — no estilo de atendimento humano real de
 * WhatsApp, nunca um bloco único tipo e-mail. Baseado nas diretrizes
 * consolidadas de posicionamento (fracionamento, dialeto/tom local vindo da
 * Base de Conhecimento, empatia antes de credenciais, sem "speech" de
 * vendedor).
 */
async function generateSpecialistReply(
  ai: GoogleGenAI,
  agent: AgentType,
  text: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[]
): Promise<{ phase: ConversationPhase; bubbles: string[]; needsHumanConfirmation: boolean } | null> {
  const historyText = buildHistoryText(history);

  const prompt = `Você é a pessoa real que atende o WhatsApp de um negócio — não um robô, não uma IA se apresentando como tal. A resposta precisa ser indistinguível de uma pessoa de verdade digitando no celular.

${AGENT_INSTRUCTIONS[agent]}

REGRAS DE ESTILO (sempre aplicar):
1. Fracione a resposta em 1 a 3 "bolhas" curtas e sequenciais (como mensagens reais de WhatsApp), nunca um bloco único tipo e-mail/panfleto.
2. Adapte vocabulário, saudações e tom ao idioma/dialeto do cliente e ao "toneOfVoice" abaixo (se vier voseo, gírias regionais, diminutivos — use-os naturalmente).
3. Empatia e foco no benefício primeiro — nunca abra com currículo, dados técnicos ou lista de qualificações.
4. Prefira perguntas abertas de diálogo a despejar informação toda de uma vez.
5. Não invente preços, horários ou dados específicos que não estão no contexto — nesse caso, diga que vai confirmar e retornar em breve.
6. Se o histórico mostra que vocês já se falaram, NUNCA se apresente de novo — continue a conversa naturalmente, como quem lembra o que já foi dito.
7. Pode usar leve leveza/humor quando cabível, mas sempre com segurança e sem soar debochado.

${contactName ? `Nome do cliente: ${contactName}.` : ''}
${knowledgeBaseContext || ''}
${historyText ? `Histórico recente da conversa (mais antiga primeiro):\n${historyText}\n` : ''}
Nova mensagem do cliente: "${text}"

Classifique também a fase atual desta conversa em UMA destas opções:
- "abertura": primeiro contato, saudação, cliente ainda curioso/explorando.
- "informacao": tirando dúvida técnica, pergunta sobre preço/procedimento/disponibilidade.
- "objecao": cliente hesitante, com medo, dúvida sobre resultado, ou pedindo desconto/"vou pensar".
- "fechamento": cliente decidido, confirmando nome/horário, pronto pra agendar.

Responda ESTRITAMENTE em JSON no formato:
{"phase": "abertura|informacao|objecao|fechamento", "bubbles": ["primeira bolha curta", "segunda bolha curta (se precisar)"], "needsHumanConfirmation": false}
Cada bolha deve ter no máximo 1-2 frases. Use só as bolhas necessárias (pode ser só 1). needsHumanConfirmation só true se agent=agendamento e já há dados suficientes pra tentar fechar.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json' },
    }),
    GEMINI_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}') as { phase?: string; bubbles?: string[]; needsHumanConfirmation?: boolean };
  const bubbles = (parsed.bubbles || []).map((b) => b.trim()).filter(Boolean);
  const validPhases: ConversationPhase[] = ['abertura', 'informacao', 'objecao', 'fechamento'];
  const phase = validPhases.includes(parsed.phase as ConversationPhase) ? (parsed.phase as ConversationPhase) : 'informacao';

  if (!bubbles.length) return null;
  return { phase, bubbles, needsHumanConfirmation: !!parsed.needsHumanConfirmation };
}

/**
 * Orquestra router + especialista: 1ª chamada decide qual agente
 * (triagem/faq/agendamento), 2ª chamada gera a resposta especializada.
 * Mede o tempo da 1ª chamada em `routerElapsedMs` pra o chamador descontar
 * esse tempo do atraso de digitação simulado da 1ª bolha (server/services/sendBubbles.ts),
 * compensando a latência extra sem fazer o cliente esperar mais no total.
 *
 * Sem fallback simulado: se o Gemini falhar, simplesmente não respondemos
 * automaticamente (melhor não responder do que responder algo genérico/errado
 * pra um cliente real).
 */
export async function generateAutoReplyForText(
  ai: GoogleGenAI | null,
  text: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[]
): Promise<AutoReplyResult | null> {
  if (!ai || !text.trim()) return null;

  try {
    const routerStart = Date.now();
    const agent = await classifyAgent(ai, text, history);
    const routerElapsedMs = Date.now() - routerStart;

    const specialist = await generateSpecialistReply(ai, agent, text, contactName, knowledgeBaseContext, history);
    if (!specialist) {
      console.warn('⚠️  Gemini Auto-Reply: resposta vazia, nada enviado.');
      return null;
    }

    return { ...specialist, agent, routerElapsedMs };
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
