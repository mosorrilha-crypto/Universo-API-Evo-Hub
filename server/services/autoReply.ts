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
import { getKnowledgeBase, resolveProductPrice, parsePriceToNumber } from './knowledgeBaseStore';
import { uploadWhatsAppMedia, sendWhatsAppMediaMessage } from './metaSend';
import { recordOutgoingMessage, getConversationCtwaClid } from './conversationStore';
import { fireMetaCapiEventForTenant } from './metaCapiService';

const GEMINI_TIMEOUT_MS = 20000;
const BUSINESS_TIMEZONE = 'America/Asuncion';

/** Credenciais Meta pra fazer o agente enviar mídia de verdade (Epic 4.5.2) — mesmo par phone_number_id/access_token já resolvido por tenant em quem chama generateAutoReplyForText. */
export interface MediaSendConfig {
  phoneNumberId?: string;
  accessToken?: string;
}

export type ConversationPhase = 'abertura' | 'informacao' | 'objecao' | 'fechamento';
export type AgentType = 'triagem' | 'faq' | 'agendamento' | 'reclamacao';

export interface AutoReplyResult {
  phase: ConversationPhase;
  bubbles: string[];
  agent: AgentType;
  /** true quando precisa de atenção humana: cliente tentando fechar agendamento sem confirmação automática, ou (Epic 4.5.8) qualquer reclamação — reclamação sempre escala, nunca é resolvida só pela IA. */
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
- "reclamacao": o cliente está insatisfeito ou reclamando de um serviço JÁ REALIZADO (resultado, dor, alergia, reação), ou claramente irritado/chateado com o negócio.
${historyText ? `Histórico recente:\n${historyText}\n` : ''}
Mensagem: "${text}"
Responda ESTRITAMENTE em JSON: {"agent": "triagem|faq|agendamento|reclamacao"}`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json' },
    }),
    GEMINI_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}') as { agent?: string };
  const valid: AgentType[] = ['triagem', 'faq', 'agendamento', 'reclamacao'];
  return valid.includes(parsed.agent as AgentType) ? (parsed.agent as AgentType) : 'triagem';
}

const AGENT_INSTRUCTIONS: Record<AgentType, string> = {
  triagem: `Seu papel agora é TRIAGEM: acolher, criar rapport genuíno, e entender o que o cliente precisa antes de despachar informação. Faça perguntas abertas. Não dispare preço nem catálogo inteiro de uma vez — só o suficiente pra continuar o diálogo. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo dizendo que uma foto foi enviada, mencione isso naturalmente (nunca prometa mandar depois — ela já foi).`,
  faq: `Seu papel agora é FAQ/ESPECIALISTA: responda a dúvida específica (preço, procedimento, política) com precisão total usando SOMENTE o contexto do negócio abaixo. Se não tiver o dado exato, diga que vai confirmar — nunca invente. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo dizendo que uma foto foi enviada, mencione isso naturalmente na resposta (ex: "manda ver a foto que te mandei ali em cima") — nunca prometa mandar uma foto que já foi enviada, e nunca diga que vai mandar se a seção mostra que a tentativa falhou.`,
  agendamento: `Seu papel agora é AGENDAMENTO. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo, ela é a fonte da verdade sobre o que realmente aconteceu (disponibilidade consultada, evento criado/remarcado/cancelado, ou erro) — informe o cliente refletindo isso com precisão total, nunca contradiga o resultado real. Se essa seção NÃO aparecer (ainda faltam dados como dia/horário desejado, ou a agenda automática não está disponível agora), acolha com entusiasmo, colete os dados que faltam (nome, dia/horário desejado), e se já tiver dados suficientes pra tentar fechar avise com carinho que vai confirmar a disponibilidade e retornar em breve (nunca prometa um horário como certo nesse caso). Marque needsHumanConfirmation como true sempre que: (a) faltou ação automática mas o cliente já deu dados suficientes pra tentar fechar, ou (b) uma ação real de agenda falhou/deu erro.`,
  reclamacao: `Seu papel agora é RECLAMAÇÃO: o cliente está insatisfeito ou reportando um problema com um serviço JÁ REALIZADO (resultado, dor, alergia, reação) — ou claramente irritado/chateado. Acolha com empatia genuína e valide o que ela está sentindo. NUNCA discuta, nunca se justifique, nunca minimize o que ela relatou. NUNCA ofereça solução, reembolso, retoque ou qualquer tipo de compensação por conta própria — essa decisão é sempre de uma pessoa real. Se ela mencionar sintoma físico (dor forte, inchaço, alergia), diga com calma que vai confirmar isso com cuidado, e que se piorar procure atendimento médico. Nunca prometa prazo específico de retorno.`,
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

  const userContent = `${extraContext ? `Ações reais já executadas nesta mensagem:\n${extraContext}\n\n` : ''}${contactName ? `Nome do cliente: ${contactName}.\n` : ''}${knowledgeBaseContext || ''}
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

/**
 * Dispara o Meta CAPI (Epic 4.5.6) quando um agendamento é criado de
 * verdade — nunca bloqueia a confirmação pro cliente (chamado sem await,
 * ver executeCalendarTool). Só dispara se a conversa tiver um ctwa_clid
 * real gravado (veio de um anúncio Clique-para-WhatsApp — ver
 * conversationStore.attachAdReferralIfMissing) e se o tenant tiver
 * credencial de CAPI configurada; qualquer uma das duas ausente e não
 * dispara nada, silenciosamente.
 */
async function notifyBookingCompleted(tenantId: string, phone: string, titulo: string): Promise<void> {
  const ctwaClid = await getConversationCtwaClid(tenantId, phone);
  if (!ctwaClid) return;

  const kb = await getKnowledgeBase(tenantId);
  const product = kb?.products?.find((p) => p.name === titulo);
  const value = product ? parsePriceToNumber(resolveProductPrice(product)) : undefined;

  await fireMetaCapiEventForTenant(tenantId, {
    eventName: 'Schedule',
    phone,
    ctwaClid,
    value: value || undefined,
    contentName: titulo,
  });
}

/** "YYYY-MM-DDTHH:mm:ss" -> "HH:mm", zero-padded — mesmo formato usado na validação anti-alucinação (Epic 4.5.7). */
function extractHHmm(naiveIso: string): string {
  return naiveIso.slice(11, 16);
}

/** Extrai todo horário no formato H:mm/HH:mm citado num texto livre, normalizado com zero à esquerda — usado pela validação anti-alucinação (Epic 4.5.7). */
function extractCitedTimes(text: string): string[] {
  const matches = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || [];
  return matches.map((m) => {
    const [h, mm] = m.split(':');
    return `${h.padStart(2, '0')}:${mm}`;
  });
}

async function executeCalendarTool(
  tenantId: string,
  name: string,
  args: Record<string, any>,
  phone: string,
  cfg: CalendarConfig
): Promise<{ response: Record<string, unknown>; summary: string; confirmedTimeHHmm?: string }> {
  try {
    switch (name) {
      case 'verificar_disponibilidade': {
        const disponivel = await checkFreeBusy(tenantId, cfg, args.data_hora_inicio, args.data_hora_fim, BUSINESS_TIMEZONE);
        return {
          response: { disponivel },
          summary: `Verificou disponibilidade em ${args.data_hora_inicio}–${args.data_hora_fim}: ${disponivel ? 'LIVRE' : 'OCUPADO'}.`,
          confirmedTimeHHmm: disponivel ? extractHHmm(args.data_hora_inicio) : undefined,
        };
      }
      case 'criar_agendamento': {
        const eventId = await createCalendarEvent(tenantId, cfg, args.titulo, args.descricao || '', args.data_hora_inicio, args.data_hora_fim, BUSINESS_TIMEZONE);
        await setAppointmentForPhone(tenantId, phone, { eventId, summary: args.titulo, startIso: args.data_hora_inicio, endIso: args.data_hora_fim });
        notifyBookingCompleted(tenantId, phone, args.titulo).catch(() => {});
        return {
          response: { sucesso: true, evento_id: eventId },
          summary: `Criou o agendamento "${args.titulo}" para ${args.data_hora_inicio}–${args.data_hora_fim} com sucesso.`,
          confirmedTimeHHmm: extractHHmm(args.data_hora_inicio),
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
          confirmedTimeHHmm: extractHHmm(args.nova_data_hora_inicio),
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
): Promise<{ actionsSummary: string[]; hadError: boolean; confirmedTimes: string[] }> {
  const connected = await isGoogleCalendarConnected(tenantId);
  if (!connected) {
    return { actionsSummary: [], hadError: false, confirmedTimes: [] };
  }

  const { naive, weekday } = getNowLocalNaive(BUSINESS_TIMEZONE);
  const historyText = buildHistoryText(history);
  const existing = await getAppointmentForPhone(tenantId, phone);
  // O horário do agendamento ATIVO (se houver) é um fato conhecido de antemão
  // — citar ele numa confirmação de cancelamento/remarcação não é alucinação.
  const confirmedTimes: string[] = existing ? [extractHHmm(existing.startIso)] : [];

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
      const { response: toolResponse, summary, confirmedTimeHHmm } = await executeCalendarTool(tenantId, call.name || '', call.args || {}, phone, cfg);
      actionsSummary.push(summary);
      if ('erro' in toolResponse) hadError = true;
      if (confirmedTimeHHmm) confirmedTimes.push(confirmedTimeHHmm);
      responseParts.push({ functionResponse: { name: call.name, response: toolResponse } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { actionsSummary, hadError, confirmedTimes };
}

const FOTO_TOOLS: FunctionDeclaration[] = [
  {
    name: 'enviar_foto_exemplo',
    description: 'Envia pro cliente, como imagem real no WhatsApp, a foto de exemplo de um serviço específico do catálogo (já cadastrada na Base de Conhecimento).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nome_produto: { type: Type.STRING, description: 'Nome EXATO do produto/serviço, igual ao catálogo — nunca invente um nome que não está na lista.' },
      },
      required: ['nome_produto'],
    },
  },
];

/**
 * Ferramenta nova (Epic 4.5.2, paridade com o projeto antigo da Monique):
 * decide se a mensagem do cliente pede/justifica mandar a foto de exemplo
 * de um serviço específico e, se sim, envia de verdade via Meta Cloud API
 * (mesmo upload usado no envio manual do painel,
 * `server/routes/conversations.ts` `/send-example-photo`). Chamada só uma
 * vez por mensagem recebida (não é um loop como `runAgendamentoTools`) e
 * executa no máximo 1 chamada de ferramenta — nunca manda mais de 1 foto
 * pra mesma mensagem do cliente. Limite de "no máximo 1 foto por conversa
 * inteira" é regra de segmento (camada 2, Etapa 4 — ainda não escrita),
 * não está garantido aqui.
 */
async function runFotoTool(
  tenantId: string,
  ai: GoogleGenAI,
  text: string,
  phone: string,
  mediaConfig: MediaSendConfig,
  history?: { sender: 'lead' | 'agent'; text?: string }[]
): Promise<{ actionsSummary: string[] }> {
  const kb = await getKnowledgeBase(tenantId);
  const productsWithPhoto = (kb?.products || []).filter((p) => p.exampleImageBase64);
  if (!productsWithPhoto.length) return { actionsSummary: [] };

  const historyText = buildHistoryText(history);
  const catalogList = productsWithPhoto.map((p) => `- ${p.name}`).join('\n');

  const prompt = `Produtos/serviços com foto de exemplo disponível pra enviar de verdade:
${catalogList}

${historyText ? `Histórico recente da conversa:\n${historyText}\n` : ''}Mensagem do cliente: "${text}"

Só chame enviar_foto_exemplo se o cliente pediu explicitamente pra ver foto/exemplo/resultado de um desses serviços, ou está claramente decidido sobre um serviço específico dessa lista e uma foto ajudaria a fechar. Se o cliente não mencionou nada relacionado a um desses serviços, ou o interesse ainda não está claro, NÃO chame nenhuma ferramenta.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ functionDeclarations: FOTO_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    }),
    GEMINI_TIMEOUT_MS
  );

  const call = response.functionCalls?.[0];
  if (!call || call.name !== 'enviar_foto_exemplo') return { actionsSummary: [] };

  const nomeProduto = (call.args?.nome_produto as string) || '';
  const product = productsWithPhoto.find((p) => p.name === nomeProduto);
  if (!product?.exampleImageBase64) {
    return { actionsSummary: [`Tentou enviar foto de "${nomeProduto}" mas esse produto não tem foto de exemplo cadastrada.`] };
  }

  try {
    const mimeType = product.exampleImageMimeType || 'image/jpeg';
    const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, product.exampleImageBase64, mimeType, `${product.name}.jpg`);
    await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType, product.name);
    await recordOutgoingMessage(tenantId, phone, {
      type: 'image',
      text: `📷 Foto de exemplo: ${product.name}`,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    });
    return { actionsSummary: [`Enviou a foto de exemplo real de "${product.name}" pro cliente agora.`] };
  } catch (err: any) {
    return { actionsSummary: [`Tentou enviar a foto de "${product.name}" mas falhou (${err.message}) — não prometa que a foto foi enviada.`] };
  }
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
  segment: string = DEFAULT_SEGMENT,
  mediaConfig?: MediaSendConfig
): Promise<AutoReplyResult | null> {
  if (!ai || !text.trim()) return null;

  try {
    const routerStart = Date.now();
    const agent = await classifyAgent(ai, text, history);
    const routerElapsedMs = Date.now() - routerStart;

    let extraContext: string | undefined;
    let forcedHumanConfirmation = false;
    let confirmedTimes: string[] = [];

    if (agent === 'agendamento' && phone && calendarConfig?.clientId && calendarConfig?.clientSecret) {
      const result = await runAgendamentoTools(tenantId, ai, text, phone, calendarConfig, history);
      if (result.actionsSummary.length) {
        extraContext = result.actionsSummary.map((s) => `- ${s}`).join('\n');
      }
      forcedHumanConfirmation = result.hadError;
      confirmedTimes = result.confirmedTimes;
    } else if (agent !== 'agendamento' && phone && mediaConfig?.phoneNumberId && mediaConfig?.accessToken) {
      const { actionsSummary } = await runFotoTool(tenantId, ai, text, phone, mediaConfig, history);
      if (actionsSummary.length) {
        extraContext = actionsSummary.map((s) => `- ${s}`).join('\n');
      }
    }

    const specialist = await generateSpecialistReply(ai, agent, text, segment, contactName, knowledgeBaseContext, history, extraContext);
    if (!specialist) {
      console.warn('⚠️  Gemini Auto-Reply: resposta vazia, nada enviado.');
      return null;
    }

    // Epic 4.5.7 — anti-alucinação: se as ferramentas de agenda rodaram
    // nesta mensagem (só faz sentido validar quando há algo real pra
    // comparar), nenhum horário citado na resposta pode ser diferente dos
    // horários realmente confirmados pelas ferramentas. Se o modelo citou
    // um horário não confirmado, a resposta é substituída por uma correção
    // segura antes de sair pro cliente — nunca deixa passar um horário
    // inventado.
    let bubbles = specialist.bubbles;
    if (agent === 'agendamento' && confirmedTimes.length) {
      const citedTimes = extractCitedTimes(bubbles.join(' '));
      const invalidTimes = citedTimes.filter((t) => !confirmedTimes.includes(t));
      if (invalidTimes.length) {
        console.warn(`⚠️  [Anti-alucinação] tenant=${tenantId} modelo citou horário(s) não confirmado(s) (${invalidTimes.join(', ')}) — corrigindo resposta. Confirmados: ${confirmedTimes.join(', ')}.`);
        bubbles = [`Deixa eu confirmar certinho com você: o horário disponível é ${confirmedTimes.join(' ou ')}. Fico assim mesmo ou prefere outro horário?`];
      }
    }

    // Epic 4.5.8 — toda reclamação escala pra humano, sem exceção. A IA
    // nunca resolve reclamação sozinha (nunca oferece reembolso/retoque por
    // conta própria), então needsHumanConfirmation é sempre true aqui,
    // independente do que o modelo tenha marcado.
    const needsHumanConfirmation = agent === 'reclamacao' ? true : specialist.needsHumanConfirmation || forcedHumanConfirmation;

    return { ...specialist, bubbles, needsHumanConfirmation, agent, routerElapsedMs };
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
