import { Type, FunctionCallingConfigMode, type GoogleGenAI, type Content, type Part, type FunctionDeclaration } from '@google/genai';
import {
  checkFreeBusy,
  createCalendarEvent,
  rescheduleCalendarEvent,
  cancelCalendarEvent,
  isGoogleCalendarConnected,
  type CalendarConfig,
} from './googleCalendar';
import { getAppointmentForPhone, setAppointmentForPhone, clearAppointmentForPhone } from './appointmentStore';
import { DEFAULT_SEGMENT } from './tenantProfileStore';

const GEMINI_TIMEOUT_MS = 20000;
const BUSINESS_TIMEZONE = 'America/Asuncion';

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
  agendamento: `Seu papel agora é AGENDAMENTO. Se a seção "Ações já executadas na agenda real" aparecer abaixo, ela é a fonte da verdade sobre o que realmente aconteceu (disponibilidade consultada, evento criado/remarcado/cancelado, ou erro) — informe o cliente refletindo isso com precisão total, nunca contradiga o resultado real. Se essa seção NÃO aparecer (ainda faltam dados como dia/horário desejado, ou a agenda automática não está disponível agora), acolha com entusiasmo, colete os dados que faltam (nome, dia/horário desejado), e se já tiver dados suficientes pra tentar fechar avise com carinho que vai confirmar a disponibilidade e retornar em breve (nunca prometa um horário como certo nesse caso). Marque needsHumanConfirmation como true sempre que: (a) faltou ação automática mas o cliente já deu dados suficientes pra tentar fechar, ou (b) uma ação real de agenda falhou/deu erro.`,
};

/**
 * Camada 2 (segmento) — regras fixas por segmento de negócio, ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1. Conteúdo real ainda é a
 * Etapa 4 (pendente); hoje só existe o segmento da Monique, sem regras
 * próprias registradas ainda — a chave existe pra o mecanismo de camadas
 * não depender de uma segunda migração quando o conteúdo chegar.
 */
const SEGMENT_LAYERS: Record<string, string> = {
  beauty_studio: '',
};

/**
 * Camada 1 (global, fixa, nunca muda por tenant/segmento) + Camada 2
 * (segmento) combinadas — vão como `systemInstruction` da chamada ao
 * Gemini, separadas do conteúdo variável (tenant + dinâmico + histórico),
 * que vai no `contents` da mensagem. Isso é o que a Etapa 3 do roadmap do
 * agente vertical pede: parar de concatenar tudo numa string só.
 */
function buildGlobalAndSegmentLayer(agent: AgentType, segment: string): string {
  const segmentRules = SEGMENT_LAYERS[segment];
  return `Você é a pessoa real que atende o WhatsApp de um negócio — não um robô, não uma IA se apresentando como tal. A resposta precisa ser indistinguível de uma pessoa de verdade digitando no celular.

${AGENT_INSTRUCTIONS[agent]}
${segmentRules ? `\nRegras específicas do segmento:\n${segmentRules}\n` : ''}
REGRAS DE ESTILO (sempre aplicar):
1. Fracione a resposta em 1 a 3 "bolhas" curtas e sequenciais (como mensagens reais de WhatsApp), nunca um bloco único tipo e-mail/panfleto.
2. Adapte vocabulário, saudações e tom ao idioma/dialeto do cliente e ao "toneOfVoice" do contexto do negócio (se vier voseo, gírias regionais, diminutivos — use-os naturalmente).
3. Empatia e foco no benefício primeiro — nunca abra com currículo, dados técnicos ou lista de qualificações.
4. Prefira perguntas abertas de diálogo a despejar informação toda de uma vez.
5. Não invente preços, horários ou dados específicos que não estão no contexto — nesse caso, diga que vai confirmar e retornar em breve.
6. Se o histórico mostra que vocês já se falaram, NUNCA se apresente de novo — continue a conversa naturalmente, como quem lembra o que já foi dito.
7. Pode usar leve leveza/humor quando cabível, mas sempre com segurança e sem soar debochado.

Classifique também a fase atual desta conversa em UMA destas opções:
- "abertura": primeiro contato, saudação, cliente ainda curioso/explorando.
- "informacao": tirando dúvida técnica, pergunta sobre preço/procedimento/disponibilidade.
- "objecao": cliente hesitante, com medo, dúvida sobre resultado, ou pedindo desconto/"vou pensar".
- "fechamento": cliente decidido, confirmando nome/horário, pronto pra agendar.

Responda ESTRITAMENTE em JSON no formato:
{"phase": "abertura|informacao|objecao|fechamento", "bubbles": ["primeira bolha curta", "segunda bolha curta (se precisar)"], "needsHumanConfirmation": false}
Cada bolha deve ter no máximo 1-2 frases. Use só as bolhas necessárias (pode ser só 1). needsHumanConfirmation só true se agent=agendamento e já há dados suficientes pra tentar fechar.`;
}

/**
 * Gera a resposta do agente especializado (já escolhido pelo router acima),
 * fracionada em "bolhas" curtas — no estilo de atendimento humano real de
 * WhatsApp, nunca um bloco único tipo e-mail. Baseado nas diretrizes
 * consolidadas de posicionamento (fracionamento, dialeto/tom local vindo da
 * Base de Conhecimento, empatia antes de credenciais, sem "speech" de
 * vendedor).
 *
 * Camadas 1+2 (global/segmento, fixas) vão em `systemInstruction`. Camadas
 * 3+4 (tenant/dinâmico) + contexto transacional (histórico/mensagem atual)
 * vão em `contents`, como mensagens distintas — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seções 1 e 7 (Etapa 3).
 */
async function generateSpecialistReply(
  ai: GoogleGenAI,
  agent: AgentType,
  text: string,
  segment: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  extraContext?: string
): Promise<{ phase: ConversationPhase; bubbles: string[]; needsHumanConfirmation: boolean } | null> {
  const historyText = buildHistoryText(history);
  const systemInstruction = buildGlobalAndSegmentLayer(agent, segment);

  const userContent = `${extraContext ? `Ações já executadas na agenda real:\n${extraContext}\n\n` : ''}${contactName ? `Nome do cliente: ${contactName}.\n` : ''}${knowledgeBaseContext || ''}
${historyText ? `Histórico recente da conversa (mais antiga primeiro):\n${historyText}\n` : ''}
Nova mensagem do cliente: "${text}"`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ text: userContent }],
      config: { systemInstruction, responseMimeType: 'application/json' },
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

/** Data/hora atual "de parede" no fuso do negócio — dá ao agente uma âncora real pra resolver referências relativas ("amanhã às 15h") sem precisar calcular fuso horário sozinho. */
function getNowLocalNaive(timeZone: string): { naive: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { naive: `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`, weekday: map.weekday };
}

const DATA_HORA_PARAM_DESCRIPTION = `Data e hora LOCAL (fuso ${BUSINESS_TIMEZONE}), formato "YYYY-MM-DDTHH:mm:ss", SEM offset UTC. Ex: "2026-08-06T15:00:00".`;

/**
 * Ferramentas reais de agenda expostas ao agente de agendamento via
 * function-calling do Gemini. Nenhuma delas recebe um "evento_id" do
 * modelo — remarcar/cancelar sempre resolvem o evento certo a partir do
 * telefone de quem está conversando (server/services/appointmentStore.ts),
 * pra nunca depender do modelo "lembrar" ou inventar um ID.
 */
const AGENDAMENTO_TOOLS: FunctionDeclaration[] = [
  {
    name: 'verificar_disponibilidade',
    description: 'Verifica se um intervalo de horário está livre na agenda real do negócio, antes de tentar criar um agendamento.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        data_hora_inicio: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
        data_hora_fim: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
      },
      required: ['data_hora_inicio', 'data_hora_fim'],
    },
  },
  {
    name: 'criar_agendamento',
    description: 'Cria um agendamento real na agenda do negócio, DEPOIS de confirmar que o horário está disponível.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        titulo: { type: Type.STRING, description: 'Título curto do serviço/procedimento agendado.' },
        descricao: { type: Type.STRING, description: 'Detalhes relevantes: nome do cliente, telefone, observações.' },
        data_hora_inicio: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
        data_hora_fim: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
      },
      required: ['titulo', 'data_hora_inicio', 'data_hora_fim'],
    },
  },
  {
    name: 'remarcar_agendamento',
    description: 'Remarca o agendamento ATIVO deste contato (já identificado pelo telefone da conversa) para um novo horário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nova_data_hora_inicio: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
        nova_data_hora_fim: { type: Type.STRING, description: DATA_HORA_PARAM_DESCRIPTION },
      },
      required: ['nova_data_hora_inicio', 'nova_data_hora_fim'],
    },
  },
  {
    name: 'cancelar_agendamento',
    description: 'Cancela o agendamento ATIVO deste contato (já identificado pelo telefone da conversa).',
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

async function executeCalendarTool(
  tenantId: string,
  name: string,
  args: Record<string, any>,
  phone: string,
  cfg: CalendarConfig
): Promise<{ response: Record<string, unknown>; summary: string }> {
  try {
    switch (name) {
      case 'verificar_disponibilidade': {
        const disponivel = await checkFreeBusy(tenantId, cfg, args.data_hora_inicio, args.data_hora_fim, BUSINESS_TIMEZONE);
        return {
          response: { disponivel },
          summary: `Verificou disponibilidade em ${args.data_hora_inicio}–${args.data_hora_fim}: ${disponivel ? 'LIVRE' : 'OCUPADO'}.`,
        };
      }
      case 'criar_agendamento': {
        const eventId = await createCalendarEvent(tenantId, cfg, args.titulo, args.descricao || '', args.data_hora_inicio, args.data_hora_fim, BUSINESS_TIMEZONE);
        await setAppointmentForPhone(tenantId, phone, { eventId, summary: args.titulo, startIso: args.data_hora_inicio, endIso: args.data_hora_fim });
        return {
          response: { sucesso: true, evento_id: eventId },
          summary: `Criou o agendamento "${args.titulo}" para ${args.data_hora_inicio}–${args.data_hora_fim} com sucesso.`,
        };
      }
      case 'remarcar_agendamento': {
        const existing = await getAppointmentForPhone(tenantId, phone);
        if (!existing) {
          return {
            response: { erro: 'Nenhum agendamento ativo encontrado pra este contato.' },
            summary: 'Tentou remarcar mas não há nenhum agendamento ativo registrado pra este contato.',
          };
        }
        await rescheduleCalendarEvent(tenantId, cfg, existing.eventId, args.nova_data_hora_inicio, args.nova_data_hora_fim, BUSINESS_TIMEZONE);
        await setAppointmentForPhone(tenantId, phone, { ...existing, startIso: args.nova_data_hora_inicio, endIso: args.nova_data_hora_fim });
        return {
          response: { sucesso: true },
          summary: `Remarcou o agendamento existente para ${args.nova_data_hora_inicio}–${args.nova_data_hora_fim} com sucesso.`,
        };
      }
      case 'cancelar_agendamento': {
        const existing = await getAppointmentForPhone(tenantId, phone);
        if (!existing) {
          return {
            response: { erro: 'Nenhum agendamento ativo encontrado pra este contato.' },
            summary: 'Tentou cancelar mas não há nenhum agendamento ativo registrado pra este contato.',
          };
        }
        await cancelCalendarEvent(tenantId, cfg, existing.eventId);
        await clearAppointmentForPhone(tenantId, phone);
        return { response: { sucesso: true }, summary: 'Cancelou o agendamento existente com sucesso.' };
      }
      default:
        return { response: { erro: `Ferramenta desconhecida: ${name}` }, summary: `Tentou chamar uma ferramenta desconhecida (${name}).` };
    }
  } catch (err: any) {
    return { response: { erro: err.message }, summary: `Erro ao executar ${name}: ${err.message}` };
  }
}

/**
 * Roda o agente de agendamento com ferramentas reais (function-calling) sobre
 * o Google Calendar. Não gera a resposta final ao cliente diretamente — só
 * executa as ações reais (consultar/criar/remarcar/cancelar) e devolve um
 * resumo em texto do que aconteceu de verdade, pra generateSpecialistReply
 * humanizar a resposta em cima de fatos, nunca de suposição do modelo.
 */
async function runAgendamentoTools(
  tenantId: string,
  ai: GoogleGenAI,
  text: string,
  phone: string,
  cfg: CalendarConfig,
  history?: { sender: 'lead' | 'agent'; text?: string }[]
): Promise<{ actionsSummary: string[]; hadError: boolean }> {
  const connected = await isGoogleCalendarConnected(tenantId);
  if (!connected) {
    return { actionsSummary: [], hadError: false };
  }

  const { naive, weekday } = getNowLocalNaive(BUSINESS_TIMEZONE);
  const historyText = buildHistoryText(history);
  const existing = await getAppointmentForPhone(tenantId, phone);

  const prompt = `Você controla a agenda real de um negócio de estética/micropigmentação através de ferramentas. O cliente quer marcar, remarcar ou cancelar um horário.

Data e hora ATUAL (fuso ${BUSINESS_TIMEZONE}): ${naive} (${weekday}).
${existing ? `Este contato já tem um agendamento ativo: "${existing.summary}" começando em ${existing.startIso} (fuso ${BUSINESS_TIMEZONE}).` : 'Este contato não tem nenhum agendamento ativo no momento.'}
${historyText ? `Histórico recente da conversa:\n${historyText}\n` : ''}
Mensagem do cliente: "${text}"

Regras:
- Sempre passe datas/horas no formato "YYYY-MM-DDTHH:mm:ss" (hora local, SEM offset), fuso ${BUSINESS_TIMEZONE}.
- Se faltar informação essencial pra agir (dia/horário desejado), NÃO chame nenhuma ferramenta.
- Antes de criar um agendamento novo, verifique disponibilidade primeiro; só crie se estiver livre.
- Duração padrão de uma sessão, se o cliente não especificar: 90 minutos.
- Pra remarcar/cancelar, você NÃO precisa saber o ID do evento — as ferramentas já resolvem isso sozinhas a partir deste contato.`;

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
  const actionsSummary: string[] = [];
  let hadError = false;

  for (let i = 0; i < 4; i++) {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents,
        config: {
          tools: [{ functionDeclarations: AGENDAMENTO_TOOLS }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      }),
      GEMINI_TIMEOUT_MS
    );

    const calls = response.functionCalls;
    if (!calls || !calls.length) break;

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts: Part[] = [];
    for (const call of calls) {
      const { response: toolResponse, summary } = await executeCalendarTool(tenantId, call.name || '', call.args || {}, phone, cfg);
      actionsSummary.push(summary);
      if ('erro' in toolResponse) hadError = true;
      responseParts.push({ functionResponse: { name: call.name, response: toolResponse } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { actionsSummary, hadError };
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
  tenantId: string,
  ai: GoogleGenAI | null,
  text: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  phone?: string,
  calendarConfig?: CalendarConfig,
  segment: string = DEFAULT_SEGMENT
): Promise<AutoReplyResult | null> {
  if (!ai || !text.trim()) return null;

  try {
    const routerStart = Date.now();
    const agent = await classifyAgent(ai, text, history);
    const routerElapsedMs = Date.now() - routerStart;

    let extraContext: string | undefined;
    let forcedHumanConfirmation = false;

    if (agent === 'agendamento' && phone && calendarConfig?.clientId && calendarConfig?.clientSecret) {
      const { actionsSummary, hadError } = await runAgendamentoTools(tenantId, ai, text, phone, calendarConfig, history);
      if (actionsSummary.length) {
        extraContext = actionsSummary.map((s) => `- ${s}`).join('\n');
      }
      forcedHumanConfirmation = hadError;
    }

    const specialist = await generateSpecialistReply(ai, agent, text, segment, contactName, knowledgeBaseContext, history, extraContext);
    if (!specialist) {
      console.warn('⚠️  Gemini Auto-Reply: resposta vazia, nada enviado.');
      return null;
    }

    return { ...specialist, needsHumanConfirmation: specialist.needsHumanConfirmation || forcedHumanConfirmation, agent, routerElapsedMs };
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
