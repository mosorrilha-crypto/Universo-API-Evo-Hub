import { Type, FunctionCallingConfigMode, type GoogleGenAI, type Content, type Part, type FunctionDeclaration } from '@google/genai';
import {
  checkFreeBusy,
  rescheduleCalendarEvent,
  cancelCalendarEvent,
  isGoogleCalendarConnected,
  findWeeklyAvailability,
  type CalendarConfig,
} from './googleCalendar';
import { getAppointmentForPhone, setAppointmentForPhone, clearAppointmentForPhone, confirmPayment, createAppointmentHold, findOverlappingHold } from './appointmentStore';
import { runExclusiveForTenant } from './perTenantCalendarLock';
import { DEFAULT_SEGMENT, getTenantBusinessHours, formatBusinessHoursForPrompt, type BusinessHours } from './tenantProfileStore';
import { getKnowledgeBase, resolveProductAmountByName, isNonBookableProduct, findProductDurationMinutes, findProductMatch, type AgentKnowledgeBase, type AgentProduct } from './knowledgeBaseStore';
import { createPreReservation } from './preReservationStore';
import { uploadWhatsAppMedia, sendWhatsAppMediaMessage } from './metaSend';
import { sendEvolutionMediaMessage } from './evolutionSend';
import { getKnowledgeBaseVideo } from './knowledgeBaseVideoStore';
import { getGlobalPromptLayerOverride, DEFAULT_GLOBAL_LAYER } from './globalPromptStore';
import { resolveEffectiveGlobalLayer } from './tenantPromptLayerStore';
import { recordOutgoingMessage, getConversationCtwaClid } from './conversationStore';
import { saveMediaImage } from './mediaImageStore';
import { fireMetaCapiEventForTenant } from './metaCapiService';
import { getCachedSystemInstruction, invalidateAllSystemInstructionCaches } from './geminiSystemInstructionCache';
import { recordGeminiUsage, type GeminiCallSite } from './tokenUsageStore';
import { callGroqJsonCompletion } from './groqClient';
import { withStructuredLog } from './structuredLog';

import { GEMINI_TIMEOUT_MS, withGeminiRetry } from '../gemini';

const BUSINESS_TIMEZONE = 'America/Asuncion';

/**
 * Credenciais Meta pra fazer o agente enviar mídia de verdade (Epic 4.5.2) —
 * mesmo par phone_number_id/access_token já resolvido por tenant em quem
 * chama generateAutoReplyForText. Instagram (Fase 1, 15/08/2026) ainda não
 * suporta envio de mídia pela ferramenta do agente — union type já prevê o
 * provider pra tipar corretamente o objeto montado em webhooks.ts, mas
 * hasMediaSendConfig abaixo sempre devolve false pra ele até a Fase 2.
 */
export interface MediaSendConfig {
  provider?: 'meta' | 'evolution' | 'instagram';
  phoneNumberId?: string;
  accessToken?: string;
  evolutionInstanceName?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  /** Só pra buscar o binário do vídeo de exemplo no Storage (knowledgeBaseVideoStore.ts) na hora de enviar — o vídeo, ao contrário da foto, não vem inline na Base de Conhecimento. */
  supabaseUrl?: string;
  supabaseKey?: string;
}

/**
 * Bug real de produção (13/08/2026): o gate que decide se runMidiaTool roda
 * só checava phoneNumberId/accessToken — campos exclusivos do provider Meta.
 * Pra qualquer tenant configurado via Evolution API (QR Code, ex: Clic
 * Piscinas), a ferramenta de foto/vídeo NUNCA rodava, mesmo com credencial
 * Evolution completa — sobreviveu intacto às rodadas de correção de
 * alucinação/match de nome (#222, #223) porque nenhuma delas tocou essa
 * linha específica. Cliente pedia vídeo, o agente respondia corretamente
 * "não tenho" (a ferramenta nunca era chamada pra sequer tentar).
 */
function hasMediaSendConfig(mediaConfig?: MediaSendConfig): boolean {
  if (!mediaConfig) return false;
  return mediaConfig.provider === 'evolution'
    ? !!(mediaConfig.evolutionInstanceName && mediaConfig.evolutionApiUrl && mediaConfig.evolutionApiKey)
    : !!(mediaConfig.phoneNumberId && mediaConfig.accessToken);
}

export type ConversationPhase = 'abertura' | 'informacao' | 'objecao' | 'fechamento';
export type AgentType = 'triagem' | 'faq' | 'agendamento' | 'reclamacao';

export interface AutoReplyResult {
  phase: ConversationPhase;
  bubbles: string[];
  agent: AgentType;
  /** true quando precisa de atenção humana: cliente tentando fechar agendamento sem confirmação automática, ou (Epic 4.5.8) qualquer reclamação — reclamação sempre escala, nunca é resolvida só pela IA. */
  needsHumanConfirmation: boolean;
  /**
   * true só no caso de alucinação de verdade (nenhuma ferramenta de agenda
   * confirmou o horário citado E não bate com nenhum agendamento real já
   * existente) — sinaliza que a resposta automática pra este número deve
   * parar até um humano assumir, em vez de tentar de novo na próxima
   * mensagem. Achado real em produção: sem isso, o mesmo fallback genérico
   * saía IDÊNTICO várias vezes seguidas na mesma conversa (a causa raiz de
   * cada repetição já tinha sido corrigida uma vez, mas nada impedia o
   * agente de cair na mesma alucinação de novo na mensagem seguinte).
   */
  stopAutoReply: boolean;
  /** ms gastos na chamada de roteamento — usado pra descontar do atraso de digitação da 1ª bolha, compensando a latência extra do router. */
  routerElapsedMs: number;
  /**
   * Nome que a cliente disse na conversa (não veio do perfil do WhatsApp) —
   * quem chama deve persistir isso na conversa (mesmo campo que já guarda o
   * nome de perfil) pra virar `contactName` daqui pra frente. Sem isso, o
   * nome só existe enquanto a mensagem em que ela disse ainda está dentro
   * da janela de histórico recente — depois disso o agente "esquece" o nome
   * que acabou de perguntar, exatamente o tipo de falha que mais entrega
   * que é um bot (achado em pesquisa de mercado sobre humanização).
   */
  capturedClientName?: string;
  /**
   * Acompanhamento de funil (pedido real, 15/08/2026 — server/services/pendingFollowUpJob.ts):
   * resumo curto quando a resposta pediu algo pra avaliação humana (foto de
   * trabalho anterior etc.) e ainda não tem decisão — undefined no resto.
   * Quem chama (webhooks.ts) usa isso pra marcar um acompanhamento pendente
   * que escala pro operador se ninguém resolver até o fim do dia.
   */
  pendingOwnerReview?: string;
  /**
   * Resumo curto quando a resposta ofereceu horário/opção e está esperando
   * o cliente escolher — undefined no resto. Escala pro operador se o
   * cliente não responder em ~2h30 (ver pendingFollowUpJob.ts).
   */
  awaitingCustomerChoice?: string;
  /**
   * Pedido real (20/08/2026): a lista de horários em texto livre (mesmo
   * corrigida/encurtada) ainda depende do cliente digitar um horário de
   * volta — botões de resposta rápida reais do WhatsApp resolvem isso num
   * toque. Só preenchido no gate anti-alucinação (fallback determinístico
   * que já sabe exatamente quais horários confirmados oferecer, ver
   * `confirmedTimes` abaixo) — não no caso geral de texto livre do modelo,
   * que não é estruturado o bastante pra virar botão com segurança. Quem
   * chama (webhooks.ts/sendBubbles.ts) decide: canal Meta manda como
   * interactive/button de verdade; Evolution/Instagram não suportam esse
   * tipo de mensagem, então usam só o texto normal em `bubbles` (mesmo
   * conteúdo, sem o botão) como fallback automático.
   */
  quickReplyOptions?: { bodyText: string; buttons: { id: string; title: string }[] };
}

/**
 * Fino wrapper sobre o withGeminiRetry compartilhado (server/gemini.ts,
 * extraído de cá no PR #103/issue #94 — o mesmo retry passou a valer
 * também pras rotas de análise/relatório que não tinham nenhuma proteção).
 * Local a autoReply.ts só porque a gravação de telemetria por
 * tenant+ponto-de-chamada (issue #90) é específica do agente automático —
 * nunca bloqueia nem falha o fluxo (recordGeminiUsage já engole os
 * próprios erros; .catch aqui é só rede de segurança extra, mesmo padrão
 * de notifyMetaCapiEvent).
 */
async function withGeminiRetryAndUsage<T extends { usageMetadata?: Parameters<typeof recordGeminiUsage>[2] }>(
  tenantId: string,
  callSite: GeminiCallSite,
  makeCall: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const result = await withGeminiRetry(makeCall, timeoutMs);
  recordGeminiUsage(tenantId, callSite, result.usageMetadata).catch(() => {});
  return result;
}

/**
 * Janela de histórico recente que entra no prompt (router + especialista) —
 * era 10, aumentada pra 24 (18/08/2026, achado real em produção, contato
 * "Alba Diana"): ela informou o serviço desejado nas mensagens 1, 7, 10 e
 * 17 da conversa, mas a IA voltou a perguntar "qué servicio te gustaría
 * realizarte?" na mensagem 38 — a última menção ao serviço já tinha caído
 * fora da janela de 10 mensagens bem antes disso (contando ~20 mensagens de
 * distância no caso real). Mesma classe de falha que capturedClientName já
 * resolve pro nome do cliente (persistido fora da janela, ver comentário
 * dele acima) — aqui é só um ajuste do tamanho da janela em si, não um
 * mecanismo de persistência; se um gap muito grande (conversa retomada
 * depois de semanas) continuar causando isso, o próximo passo é replicar o
 * padrão de capturedClientName pro serviço identificado.
 */
const HISTORY_WINDOW_SIZE = 24;

function buildHistoryText(history?: { sender: 'lead' | 'agent'; text?: string }[]): string {
  return (history || [])
    .filter((m) => m.text)
    .slice(-HISTORY_WINDOW_SIZE)
    .map((m) => `${m.sender === 'lead' ? 'Cliente' : 'Atendente'}: ${m.text}`)
    .join('\n');
}

const ROUTER_VALID_AGENTS: AgentType[] = ['triagem', 'faq', 'agendamento', 'reclamacao'];

/**
 * `text` pode chegar aqui já com várias mensagens de rajada coladas por
 * `\n` (messageBuffer.ts junta tudo que o cliente mandou picotado dentro da
 * janela de silêncio de 6s num único `texts.join('\n')`, sem marcar qual
 * linha é a mais recente). Achado real (18/08/2026): cliente perguntou pelo
 * combo, e antes da janela de silêncio fechar mandou uma segunda mensagem
 * pivotando pra "só cejas, preço?" — as duas linhas chegavam juntas como
 * "a Nova mensagem do cliente", sem nenhum sinal de recência, e o modelo
 * tratava as duas como igualmente atuais, respondendo ao combo (já
 * ultrapassado) e à pergunta nova na mesma resposta. Quando há mais de uma
 * linha, numera e marca explicitamente a última como a prioritária — uma
 * linha só (o caso comum) fica exatamente como antes, sem numeração.
 */
function formatClientMessageForPrompt(text: string, isBurst?: boolean): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // `isBurst` vem do messageCount real do buffer (messageBuffer.ts) quando
  // disponível. Só contar linhas é ambíguo: uma ÚNICA mensagem do WhatsApp
  // pode legitimamente ter quebras de linha internas (colar um texto,
  // Shift+Enter) e não pode ser tratada como rajada de mensagens separadas
  // por engano. Sem o sinal real (chamadores que não passam messageCount,
  // ex: transcrição de áudio, que nunca é bufferizada), cai no heurístico
  // de contar linhas de antes.
  const treatAsBurst = (isBurst !== undefined ? isBurst : lines.length > 1) && lines.length > 1;
  if (!treatAsBurst) return text;
  const numbered = lines.map((line, i) => `${i + 1}. "${line}"${i === lines.length - 1 ? ' ← mensagem mais recente, priorize responder a esta' : ''}`).join('\n');
  return `o cliente mandou estas mensagens em sequência rápida (numeradas da mais antiga pra mais recente):\n${numbered}`;
}

function buildRouterPrompt(text: string, historyText: string, isBurst?: boolean): string {
  return `Classifique a intenção principal desta mensagem de WhatsApp em UMA categoria:
- "triagem": primeiro contato, saudação, dúvida geral ainda sem foco claro, ou o cliente só está explorando.
- "faq": pergunta específica sobre preço, procedimento, horário de funcionamento, endereço/localização do negócio, ou política de pagamento/cancelamento — mesmo que a conversa esteja no meio de um agendamento, uma pergunta factual como essa é sempre "faq", nunca "agendamento".
- "agendamento": o cliente quer marcar, confirmar, remarcar ou cancelar um horário específico — não classifique como agendamento uma pergunta que só busca informação (ex: onde fica, que horas abre), mesmo que relacionada a uma visita já combinada.
- "reclamacao": o cliente está insatisfeito ou reclamando de um serviço JÁ REALIZADO (resultado, dor, alergia, reação), ou claramente irritado/chateado com o negócio.
${historyText ? `Histórico recente:\n${historyText}\n` : ''}
Mensagem: ${formatClientMessageForPrompt(text, isBurst)}
Classifique com base na mensagem mais recente do cliente — se houver mais de uma mensagem em sequência, uma pergunta anterior já superada pela última não deve mudar a categoria.
Responda ESTRITAMENTE em JSON: {"agent": "triagem|faq|agendamento|reclamacao", "confidence": 0 a 1 (o quão confiante você está nessa classificação), "reasoning": "explicação breve de 1 frase do motivo da escolha"}`;
}

function logRouterDecision(tenantId: string, phone: string | undefined, provider: 'groq' | 'gemini', agent: AgentType, confidence: unknown, reasoning: unknown): void {
  // Auditabilidade do roteamento (issue #99): sem confidence/reasoning um
  // misroteamento (ex: reclamação classificada como faq) fica invisível —
  // não dá pra auditar onde o agente está errando o tom com o lead sem
  // reconstruir manualmente a conversa inteira. Log estruturado por
  // enquanto (não persiste em banco) — não muda a decisão de roteamento em
  // si, só torna ela auditável.
  console.log(`[Router] tenant=${tenantId} phone=${phone ?? '-'} provider=${provider} agent=${agent} confidence=${typeof confidence === 'number' ? confidence : '-'} reasoning="${reasoning ?? '-'}"`);
}

/**
 * Router leve: classifica qual agente especializado deve atender este turno,
 * ANTES de gastar tokens/latência gerando a resposta de verdade. Isso é o
 * "portão" que, quando o Agendamento real (Google Calendar) existir, decide
 * quando as ferramentas de agenda entram no prompt — sem isso, toda mensagem
 * (até "quanto custa?") carregaria ferramentas de agenda à toa, arriscando o
 * modelo tentar agendar por engano.
 *
 * Fallback Groq → Gemini (plano aprovado, GROQ_API_KEY opcional): quando
 * `groqApiKey` está configurada, o Groq (mais barato/rápido) é a PRIMEIRA
 * tentativa, com 1 única chance e timeout curto (groqClient.ts) — nunca
 * disputa retry com o Gemini. Qualquer falha (rede, timeout, HTTP não-2xx,
 * JSON malformado, ou campo "agent" fora do enum) cai direto pro Gemini de
 * sempre (3 tentativas, 20s), sem propagar o erro do Groq pro chamador —
 * classificar errado por um provedor instável nunca pode virar "não
 * respondeu" pro cliente. Sem `groqApiKey`, o comportamento é 100% o de
 * antes: só Gemini.
 */
async function classifyAgent(
  tenantId: string,
  ai: GoogleGenAI,
  text: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  phone?: string,
  groqApiKey?: string,
  isBurst?: boolean
): Promise<AgentType> {
  const historyText = buildHistoryText(history);
  const prompt = buildRouterPrompt(text, historyText, isBurst);

  return withStructuredLog({ tenantId, area: 'autoReply', op: 'router' }, async () => {
    if (groqApiKey) {
      try {
        const { parsed, usage } = await callGroqJsonCompletion(groqApiKey, prompt);
        if (!ROUTER_VALID_AGENTS.includes(parsed?.agent)) {
          throw new Error(`Groq retornou "agent" fora do enum esperado: ${JSON.stringify(parsed?.agent)}`);
        }
        const agent = parsed.agent as AgentType;
        recordGeminiUsage(tenantId, 'router', usage, 'groq').catch(() => {});
        logRouterDecision(tenantId, phone, 'groq', agent, parsed?.confidence, parsed?.reasoning);
        return agent;
      } catch (err) {
        console.warn(`⚠️  [Router] Groq falhou (tenant=${tenantId}), caindo pro Gemini:`, (err as Error)?.message || err);
      }
    }

    const response = await withGeminiRetryAndUsage(
      tenantId,
      'router',
      () =>
        ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: [{ text: prompt }],
          config: { responseMimeType: 'application/json' },
        }),
      GEMINI_TIMEOUT_MS
    );

    const parsed = JSON.parse(response.text || '{}') as { agent?: string; confidence?: number; reasoning?: string };
    const agent = ROUTER_VALID_AGENTS.includes(parsed.agent as AgentType) ? (parsed.agent as AgentType) : 'triagem';
    logRouterDecision(tenantId, phone, 'gemini', agent, parsed.confidence, parsed.reasoning);
    return agent;
  });
}

const AGENT_INSTRUCTIONS: Record<AgentType, string> = {
  triagem: `Seu papel agora é TRIAGEM: acolher, criar rapport genuíno, e entender o que o cliente precisa antes de despachar informação. Faça perguntas abertas. Não dispare preço nem catálogo inteiro de uma vez — só o suficiente pra continuar o diálogo. EXCEÇÃO COMERCIAL IMPORTANTE: quando o contexto do anúncio informar que a cliente veio de uma oferta ou serviço específico do catálogo, trate esse clique como um sinal claro de interesse. Não pergunte de novo qual serviço ela procura. Apresente de forma objetiva a oferta identificada, com benefício, componentes, valor e duração SOMENTE se esses dados estiverem explícitos no contexto do negócio; em seguida, faça uma única pergunta de avanço, adequada ao estágio dela. Se ela perguntar preço ou o que inclui, responda isso primeiro e convide para o próximo passo, sem transformar a conversa em interrogatório. Se a seção "Nome do cliente" NÃO aparecer no contexto abaixo (o WhatsApp dela não tem nome de perfil configurado), pergunte o nome dela de forma natural, cedo na conversa — é o tipo de coisa que uma pessoa de verdade pergunta ao atender alguém pela primeira vez, não interrogatório. Sempre responda primeiro à dúvida real dela antes de perguntar isso, e nunca pergunte de novo se ela já ignorou. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo dizendo que uma foto ou vídeo foi enviado, mencione isso naturalmente (nunca prometa mandar depois — já foi).`,
  faq: `Seu papel agora é FAQ/ESPECIALISTA: responda a dúvida específica (preço, procedimento, política) com precisão total usando SOMENTE o contexto do negócio abaixo. Se não tiver o dado exato, diga que vai confirmar — nunca invente. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo dizendo que uma foto ou vídeo foi enviado, mencione isso naturalmente na resposta (ex: "manda ver o vídeo que te mandei ali em cima") — nunca prometa mandar uma foto/vídeo que já foi enviado, e nunca diga que vai mandar se a seção mostra que a tentativa falhou ou não existe mídia cadastrada. Se o cliente pedir a localização/endereço e o contexto abaixo trouxer um "Link de localização (Google Maps)", cole esse link exatamente como está na resposta (o WhatsApp transforma automaticamente em link clicável) — nunca invente um link nem descreva o endereço sem incluir o link quando ele existir; se não existir, responda só com o endereço em texto.`,
  agendamento: `Seu papel agora é AGENDAMENTO. Se a seção "Ações reais já executadas nesta mensagem" aparecer abaixo, ela é a fonte da verdade sobre o que realmente aconteceu (disponibilidade consultada, evento criado/remarcado/cancelado, escalado pra humano, ou erro) — informe o cliente refletindo isso com precisão total, nunca contradiga o resultado real. Se essa seção NÃO aparecer (ainda faltam dados como dia/horário desejado, ou a agenda automática não está disponível agora), acolha com entusiasmo, colete os dados que faltam (nome, dia/horário desejado), e se já tiver dados suficientes pra tentar fechar avise com carinho que vai confirmar a disponibilidade e retornar em breve (nunca prometa um horário como certo nesse caso). Marque needsHumanConfirmation como true sempre que: (a) faltou ação automática mas o cliente já deu dados suficientes pra tentar fechar, ou (b) uma ação real de agenda falhou/deu erro.

DESISTÊNCIA/CANCELAMENTO: se o cliente sinalizar que quer desistir ou cancelar, ofereça reagendar UMA ÚNICA VEZ, com empatia, sem soar insistente (ex: "Sem problema! Se for por causa do horário ou da data, me conta que a gente busca outra opção que fique melhor pra você"). Se ele confirmar a desistência de novo, aceite com elegância — NUNCA insista uma segunda vez. Se a seção "Ações reais já executadas nesta mensagem" mostrar que o cancelamento foi escalado (mais de 24h de antecedência, decisão de devolução do sinal depende de humano), diga com calma que vai confirmar isso com cuidado e retornar — nunca prometa a devolução do sinal nem confirme o cancelamento como concluído nesse caso.`,
  reclamacao: `Seu papel agora é RECLAMAÇÃO: o cliente está insatisfeito ou reportando um problema com um serviço JÁ REALIZADO (resultado, dor, alergia, reação) — ou claramente irritado/chateado. Acolha com empatia genuína e valide o que ela está sentindo. NUNCA discuta, nunca se justifique, nunca minimize o que ela relatou. NUNCA ofereça solução, reembolso, retoque ou qualquer tipo de compensação por conta própria — essa decisão é sempre de uma pessoa real. Se ela mencionar sintoma físico (dor forte, inchaço, alergia), diga com calma que vai confirmar isso com cuidado, e que se piorar procure atendimento médico. Nunca prometa prazo específico de retorno.`,
};

/**
 * Camada 1 (global) — regras fixas que valem pra QUALQUER tenant/segmento,
 * ver docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1. Resultado da Etapa 4:
 * classificação bullet-a-bullet do que era genérico dentro do businessRules
 * da Monique e foi promovido pra cá, pra não precisar ser reescrito a cada
 * novo tenant/segmento.
 */
// DEFAULT_GLOBAL_LAYER mudou de lugar pra globalPromptStore.ts — fonte
// única, evita dependência circular (esse módulo já importa
// getGlobalPromptLayerOverride de lá) e permite expor o texto padrão via
// API pro painel "Prompt Global do Agente" mostrar o que está em vigor.

/**
 * Camada 1 (global, fixa por padrão, mas editável por um saas_admin via
 * global_prompt_layer — ver globalPromptStore.ts) — vai como
 * `systemInstruction` da chamada ao Gemini, separada do conteúdo variável
 * (tenant + dinâmico + histórico), que vai no `contents` da mensagem.
 *
 * Não existe mais uma "Camada 2 (segmento)" com regras fixas em código,
 * indexadas por `tenants.segment` — removida em 14/08/2026 a pedido
 * explícito do dono do produto: nenhuma informação de negócio editável
 * deveria depender de um deploy pra mudar. Regras específicas de um
 * tenant/vertical (ex: as que existiam pro segmento beauty_studio, ou as
 * criadas pra Clic Piscinas) agora vivem só em dois lugares editáveis pelo
 * painel — Camada 1 (global_prompt_layer, saas_admin) ou a Base de
 * Conhecimento do próprio tenant (`businessRules`/`pricingAndPolicies`,
 * qualquer admin do tenant) — nunca em código. O texto que existia aqui pra
 * beauty_studio e pra Clic Piscinas foi migrado pra `businessRules` de cada
 * tenant respectivo, sem perda de conteúdo.
 */
/**
 * Achado de eficiência (14/08/2026, mesmo dia da remoção da Camada 2): a
 * Camada 1 (global) já era cacheada via Explicit Context Caching do Gemini
 * (geminiSystemInstructionCache.ts) — texto idêntico pra todo tenant,
 * escrito uma vez, reaproveitado por até 55min. A Camada 3 (Base de
 * Conhecimento do tenant), porém, NUNCA foi cacheada — sempre reenviada
 * por inteiro em `contents` a cada mensagem, mesmo sendo, na prática, tão
 * estável quanto a Camada 1 (só muda quando alguém edita a KB pelo
 * painel). Isso ficou mais caro depois da remoção da Camada 2: regras que
 * antes viviam no cache compartilhado (`beauty_studio`) passaram a viver
 * na KB de cada tenant, sem cache nenhum.
 *
 * Correção: a Camada 3 agora entra NO MESMO texto cacheado que a Camada 1,
 * com chave por (agent, tenantId) — cache por tenant em vez de
 * compartilhado entre todos, mas ainda assim cache de verdade. Não precisa
 * de invalidação explícita quando a KB muda: a checagem de hash já
 * existente em getCachedSystemInstruction detecta que o conteúdo mudou e
 * recria o cache sozinha na próxima mensagem. `contents` (dinâmico —
 * histórico, mensagem atual, resultado de ferramentas) nunca é cacheado,
 * como sempre.
 */
async function buildCachedSystemInstruction(tenantId: string, agent: AgentType, knowledgeBaseContext?: string): Promise<string> {
  // Camada 1 por tenant (18/08/2026) — tenant com cópia própria (editada
  // pelo admin dele) tem prioridade; sem cópia própria, cai na Camada 1
  // global de sempre (override do saas_admin, ou o padrão hardcoded).
  let globalLayer: string;
  try {
    globalLayer = await resolveEffectiveGlobalLayer(tenantId);
  } catch {
    globalLayer = (await getGlobalPromptLayerOverride().catch(() => null)) || DEFAULT_GLOBAL_LAYER;
  }
  return `Você é a pessoa real que atende o WhatsApp de um negócio — não um robô, não uma IA se apresentando como tal. A resposta precisa ser indistinguível de uma pessoa de verdade digitando no celular.

${AGENT_INSTRUCTIONS[agent]}

${globalLayer}

REGRAS DE ESTILO (sempre aplicar):
1. Fracione a resposta em 1 a 3 "bolhas" curtas e sequenciais (como mensagens reais de WhatsApp), nunca um bloco único tipo e-mail/panfleto — EXCETO quando as Regras de negócio do próprio tenant abaixo pedirem explicitamente para enviar um bloco único formatado (ex: lista do que inclui um pacote/promoção); nesse caso específico, use até 1 bolha maior com a formatação pedida (negrito/lista), só pra esse conteúdo.
2. Adapte vocabulário, saudações e tom ESTRITAMENTE ao "toneOfVoice" do contexto do negócio abaixo — ele é quem define dialeto, formalidade e quais expressões (incluindo diminutivos) usar ou evitar. Nunca adicione um traço de estilo (diminutivo, gíria, tratamento informal) que o toneOfVoice não pediu, mesmo que pareça natural no idioma do cliente.
3. Empatia e foco no benefício primeiro — nunca abra com currículo, dados técnicos ou lista de qualificações.
4. Prefira perguntas abertas de diálogo a despejar informação toda de uma vez — mesma exceção do item 1 quando o tenant pedir explicitamente um bloco único pra um conteúdo específico.
5. Não invente preços, horários, nome do cliente ou qualquer dado específico que não esteja explícito no contexto/histórico abaixo — nesse caso, diga que vai confirmar e retornar em breve, ou simplesmente não use um nome. Nunca chame o cliente por um nome que não apareceu no "Nome do cliente" fornecido nem foi dito por ele mesmo na conversa.
6. Se o histórico mostra que vocês já se falaram, NUNCA se apresente de novo — continue a conversa naturalmente, como quem lembra o que já foi dito.
7. Pode usar leve leveza/humor quando cabível, mas sempre com segurança e sem soar debochado.
8. Nunca use parênteses nem dois-pontos explicativos dentro da mensagem — soa a texto escrito, não a uma pessoa conversando.
9. Antes de perguntar ou afirmar algo, confira o histórico E a "Nova mensagem do cliente" abaixo — nunca repita uma pergunta/informação que o cliente já respondeu, e nunca repita algo que VOCÊ MESMO já disse antes nesta conversa (revise as últimas mensagens do "Atendente" no histórico). Se a mensagem nova já responde algo que você perguntaria, ou se você já pediu algo (ex: uma foto) e o histórico mostra que já pediu, siga a conversa a partir dali — nunca repita o mesmo pedido/pergunta/explicação com palavras diferentes.
10. As bolhas de uma mesma resposta são fragmentos de UM ÚNICO pensamento contínuo, na ordem certa — nunca duas ideias que se contradizem ou dois começos de resposta diferentes colados um atrás do outro.
11. No primeiro contato, cumprimente de forma curta e direta (ex: "Hola, ¿todo bien?") e responda a dúvida real da cliente já na mesma bolha ou na seguinte — nunca abra com frases de efeito tipo "qué gusto en escribirme/leerte/saludarte", "con gusto te ayudo/explico", "bienvenida" ou qualquer variação disso. Uma pessoa real recebendo uma pergunta direta responde a pergunta, não anuncia o quanto está feliz por ter recebido a mensagem.
12. Qualquer frase entre aspas usada como EXEMPLO no contexto do negócio abaixo (tom de voz, regras de negócio, FAQ) é referência de registro/intenção, nunca um script pra repetir palavra por palavra — varie a redação a cada vez. Repetir a mesma frase pronta em várias conversas diferentes é um dos jeitos mais fáceis de um cliente perceber que está falando com um robô, não com uma pessoa.
	13. Se o cliente mandou mais de uma mensagem em sequência rápida (você vai ver isso como mais de um turno seu de "mensagem do cliente" seguidos, sem nenhuma resposta sua entre eles), a última dessas mensagens é a que define o que responder agora — se ela muda de assunto ou pivota o pedido (ex: pergunta pelo combo e na sequência pergunta só por um item), responda à mais recente; não reabra nem repita informação sobre a mensagem anterior que ela já deixou pra trás, a menos que a mais recente dependa diretamente dela.
	14. PRIORIDADE ABSOLUTA: a nova mensagem do cliente define o trabalho deste turno. Responda PRIMEIRO cada pergunta concreta que ela contém, inclusive quando houver duas ou mais na mesma frase. Só depois, e apenas se ajudar de verdade, faça uma pergunta de avanço ou mencione agenda. Nunca substitua uma pergunta sobre preço, localização, duração, procedimento, foto ou vídeo por um catálogo, uma saudação genérica, uma oferta do anúncio ou disponibilidade de agenda.
	15. Quando a nova mensagem pedir localização/endereço e o contexto tiver Link de localização (Google Maps), inclua esse link nesta mesma resposta. Quando pedir preço e o serviço estiver claro, informe o preço oficial; se o serviço não estiver claro, peça UMA especificação curta, sem desviar para agenda. Quando pedir preço e localização juntos, responda ambos no mesmo turno.
	16. FOTO, VÍDEO E MÍDIA: só diga que enviou uma mídia quando a seção "Ações reais já executadas nesta mensagem" confirmar que o envio ocorreu. Se a ação informar falha ou não houver mídia compatível cadastrada, explique isso de forma curta e honesta, indicando a alternativa específica disponível; jamais diga genericamente que não há material nem troque o pedido por lista de serviços ou agenda.
	${knowledgeBaseContext || ''}
Classifique também a fase atual desta conversa em UMA destas opções:
- "abertura": primeiro contato, saudação, cliente ainda curioso/explorando.
- "informacao": tirando dúvida técnica, pergunta sobre preço/procedimento/disponibilidade.
- "objecao": cliente hesitante, com medo, dúvida sobre resultado, ou pedindo desconto/"vou pensar".
- "fechamento": cliente decidido, confirmando nome/horário, pronto pra agendar.

Se em algum momento desta mensagem OU do histórico a cliente disser o próprio nome, e a seção "Nome do cliente" acima NÃO tiver aparecido com esse nome (ou não tiver aparecido de jeito nenhum), preencha "nomeCapturado" com esse nome exato — nunca invente, nunca repita um nome que já apareceu em "Nome do cliente". Isso existe pra não "esquecer" o nome depois que a mensagem em que ela disse sair do histórico recente (achado real: conversa de WhatsApp não tem limite de tamanho, mas o contexto que você recebe só traz as últimas mensagens).

Acompanhamento de funil — pedido real (15/08/2026): uma auditoria de conversas reais mostrou leads esfriando sem ninguém perceber. Preencha estes dois campos SEMPRE que se aplicarem:
- "pendenteAvaliacao": preencha com um resumo bem curto (ex: "trabalho anterior de cejas, aguardando avaliação") SOMENTE quando sua resposta pediu uma foto/informação especificamente pra avaliação humana (ex: trabalho anterior, pigmento antigo) antes de decidir o procedimento — null no resto.
- "aguardandoCliente": preencha com um resumo bem curto (ex: "ofereceu sábado 15 ou segunda 17, esperando escolha") SOMENTE quando sua resposta pediu pro cliente escolher/confirmar algo necessário pra avançar rumo ao agendamento (dia, horário, qual serviço) — null no resto, e nunca preencha os dois campos ao mesmo tempo.

Responda ESTRITAMENTE em JSON no formato:
{"phase": "abertura|informacao|objecao|fechamento", "bubbles": ["primeira bolha curta", "segunda bolha curta (se precisar)"], "needsHumanConfirmation": false, "nomeCapturado": null, "pendenteAvaliacao": null, "aguardandoCliente": null}
Cada bolha deve ter no máximo 1-2 frases. Use só as bolhas necessárias (pode ser só 1). needsHumanConfirmation só true se agent=agendamento e já há dados suficientes pra tentar fechar. nomeCapturado é null na grande maioria das vezes — só preencha nos casos descritos acima.`;
}

/**
 * Issue #153, Parte 2 — encontra o produto do catálogo cujo nome aparece
 * literalmente no headline do anúncio (case-insensitive). Quando mais de um
 * bate (ex: "Cejas" e "Combo Cejas + Labios" no mesmo headline), prefere o
 * nome mais longo/específico, pra não sinalizar um serviço genérico quando
 * o anúncio na verdade é de um combo.
 */
function findServiceNamedInHeadline(adHeadline: string, products?: AgentProduct[]): AgentProduct | undefined {
  if (!products?.length) return undefined;
  const headlineLower = adHeadline.toLowerCase();
  const matches = products
    .map((product) => {
      const matchedName = [product.name, ...(product.aliases || [])]
        .filter(Boolean)
        .find((candidate) => headlineLower.includes(candidate.toLowerCase()));
      return matchedName ? { product, matchLength: matchedName.length } : null;
    })
    .filter((match): match is { product: AgentProduct; matchLength: number } => !!match);
  if (!matches.length) return undefined;
  return matches.sort((a, b) => b.matchLength - a.matchLength)[0].product;
}

/**
 * Gera a resposta do agente especializado (já escolhido pelo router acima),
 * fracionada em "bolhas" curtas — no estilo de atendimento humano real de
 * WhatsApp, nunca um bloco único tipo e-mail. Baseado nas diretrizes
 * consolidadas de posicionamento (fracionamento, dialeto/tom local vindo da
 * Base de Conhecimento, empatia antes de credenciais, sem "speech" de
 * vendedor).
 *
 * Camada 1 (global, fixa) + Camada 3 (Base de Conhecimento do tenant,
 * editável pelo painel, mas estável entre mensagens) vão juntas em
 * `systemInstruction` — cacheadas por tenant (ver buildCachedSystemInstruction
 * e geminiSystemInstructionCache.ts), desde 14/08/2026. Só o que muda de
 * verdade a cada mensagem (Camada 4 dinâmica via `extraContext`, histórico,
 * mensagem atual) vai em `contents`, nunca cacheado — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seções 1 e 7 (Etapa 3, com a
 * atualização de 14/08 no topo do documento). Não existe mais Camada 2
 * (segmento) hardcoded em código.
 */
async function generateSpecialistReply(
  tenantId: string,
  ai: GoogleGenAI,
  agent: AgentType,
  text: string,
  segment: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  extraContext?: string,
  adContext?: string,
  isBurst?: boolean
): Promise<{ phase: ConversationPhase; bubbles: string[]; needsHumanConfirmation: boolean; capturedClientName?: string; pendingOwnerReview?: string; awaitingCustomerChoice?: string } | null> {
  const historyText = buildHistoryText(history);
  const systemInstruction = await buildCachedSystemInstruction(tenantId, agent, knowledgeBaseContext);
  const specialistModel = 'gemini-3.6-flash';
  // Camada 1 (global) + Camada 3 (Base de Conhecimento do tenant) juntas
  // são idênticas em toda chamada deste (agent, tenantId) enquanto ninguém
  // editar o prompt global nem a KB — cache de contexto real do Gemini
  // evita reenviar esse texto por inteiro toda mensagem (ver
  // geminiSystemInstructionCache.ts; chave por tenant, não compartilhada,
  // já que a KB agora faz parte do texto cacheado). `null` = cache
  // indisponível por qualquer motivo; usa systemInstruction inline,
  // exatamente como sempre funcionou.
  const cachedContentName = await getCachedSystemInstruction(ai, specialistModel, `especialista:${agent}:${tenantId}`, systemInstruction);

  const contextPreamble = `${extraContext ? `Ações reais já executadas nesta mensagem:\n${extraContext}\n\n` : ''}${adContext ? `${adContext}\n\n` : ''}${contactName ? `Nome do cliente: ${contactName}.\n` : ''}${historyText ? `Histórico recente da conversa (mais antiga primeiro):\n${historyText}\n` : ''}`;

  // Estrutural, não só textual (18/08/2026): messageBuffer.ts agrupa
  // mensagens de rajada do cliente (dentro da janela de 6s de silêncio) num
  // único `text` com `\n` entre elas. Antes isso virava uma string achatada
  // só, sem sinal de recência real pro modelo — em vez de confiar só numa
  // marcação textual ("mensagem mais recente"), cada linha de rajada agora
  // vira seu próprio turno `role: 'user'` no array de `contents`, na ordem
  // em que o cliente mandou. O array `contents` do Gemini já é uma sequência
  // ordenada de turnos — deixar a recência ser estrutural (posição no
  // array), não uma convenção textual que o modelo precisa interpretar
  // corretamente, é mais robusto contra o modelo tratar mensagens antigas e
  // novas como igualmente atuais.
  const burstLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // `isBurst` vem do messageCount real do buffer de rajada (messageBuffer.ts)
  // quando disponível. Contar linhas sozinho é ambíguo: uma ÚNICA mensagem
  // do WhatsApp pode ter quebras de linha internas legítimas (texto colado,
  // Shift+Enter) — sem o sinal real, essa mensagem seria fatiada por engano
  // em vários turnos "role: user" separados, como se fosse rajada de
  // mensagens distintas. Sem messageCount disponível (chamadores que não
  // passam isBurst, ex: transcrição de áudio, nunca bufferizada), cai no
  // heurístico de contar linhas de antes.
  const treatAsBurst = (isBurst !== undefined ? isBurst : burstLines.length > 1) && burstLines.length > 1;
  const burstMessages = treatAsBurst ? burstLines : [text];
  // Caso comum (uma única mensagem, sem rajada): mantém o formato de sempre
  // (`contents: [{ text }]`, sem role/parts) — inclusive pra não mudar o
  // formato de request que os testes/fakes de Gemini já assumem pra esse
  // caso. Só entra no formato multi-turno (abaixo) quando há de fato mais
  // de uma mensagem agrupada pelo buffer de rajada, que é o único cenário
  // onde a ambiguidade de recência acontecia de verdade.
  const contents: Content[] | { text: string }[] =
    burstMessages.length === 1
      ? [{ text: `${contextPreamble}Nova mensagem do cliente: "${burstMessages[0]}"` }]
      : burstMessages.map((line, i) => ({
          role: 'user' as const,
          parts: [{ text: i === 0 ? `${contextPreamble}Nova mensagem do cliente: "${line}"` : `Mensagem seguinte do cliente (mais recente): "${line}"` }],
        }));

  const callSpecialist = (config: { cachedContent: string } | { systemInstruction: string }) =>
    withGeminiRetryAndUsage(
      tenantId,
      'especialista',
      () =>
        ai.models.generateContent({
          model: specialistModel,
          contents,
          config: { ...config, responseMimeType: 'application/json' },
        }),
      GEMINI_TIMEOUT_MS
    );

  const response = await withStructuredLog({ tenantId, area: 'autoReply', op: `especialista:${agent}` }, async () => {
    try {
      return await callSpecialist(cachedContentName ? { cachedContent: cachedContentName } : { systemInstruction });
    } catch (err) {
      // Rede de segurança extra: se a chamada com cachedContent falhar mesmo
      // depois do retry padrão (ex: cache expirou entre criar e usar, corrida
      // rara já que o TTL é de 55min), tenta UMA vez a mais sem cache antes de
      // desistir — a resposta ao cliente nunca pode depender do cache de
      // contexto dar certo.
      if (!cachedContentName) throw err;
      console.warn('⚠️  [Gemini Cache] chamada com cachedContent falhou mesmo após retry — tentando de novo sem cache:', (err as Error)?.message || err);
      invalidateAllSystemInstructionCaches();
      return await callSpecialist({ systemInstruction });
    }
  });

  const parsed = JSON.parse(response.text || '{}') as {
    phase?: string;
    bubbles?: string[];
    needsHumanConfirmation?: boolean;
    nomeCapturado?: string | null;
    pendenteAvaliacao?: string | null;
    aguardandoCliente?: string | null;
  };
  const bubbles = (parsed.bubbles || []).map((b) => b.trim()).filter(Boolean);
  const validPhases: ConversationPhase[] = ['abertura', 'informacao', 'objecao', 'fechamento'];
  const phase = validPhases.includes(parsed.phase as ConversationPhase) ? (parsed.phase as ConversationPhase) : 'informacao';
  // Só aceita nomeCapturado quando ainda não tínhamos nenhum nome pra essa
  // cliente — nunca deixa um nome extraído por engano sobrescrever o nome
  // real de perfil do WhatsApp (contactName), que é sempre mais confiável.
  const capturedClientName = !contactName && typeof parsed.nomeCapturado === 'string' && parsed.nomeCapturado.trim()
    ? parsed.nomeCapturado.trim()
    : undefined;

  if (!bubbles.length) return null;
  // Acompanhamento de funil (pedido real, 15/08/2026 — server/services/pendingFollowUpJob.ts):
  // strings curtas e opcionais, não booleans — já vêm com o motivo pronto
  // pra virar o texto do escalonamento, sem precisar adivinhar depois.
  const pendingOwnerReview = typeof parsed.pendenteAvaliacao === 'string' && parsed.pendenteAvaliacao.trim() ? parsed.pendenteAvaliacao.trim() : undefined;
  const awaitingCustomerChoice = typeof parsed.aguardandoCliente === 'string' && parsed.aguardandoCliente.trim() ? parsed.aguardandoCliente.trim() : undefined;
  return { phase, bubbles, needsHumanConfirmation: !!parsed.needsHumanConfirmation, capturedClientName, pendingOwnerReview, awaitingCustomerChoice };
}

/**
 * Data/hora atual "de parede" no fuso do negócio — dá ao agente uma âncora
 * real pra resolver referências relativas ("amanhã às 15h") sem precisar
 * calcular fuso horário sozinho. Exportada porque `conversations.ts`
 * (agendamento manual, issue #182) reusa a mesma técnica de comparação de
 * "já passou?" contra um agendamento existente — mesmo bug corrigido nos
 * dois lugares, ver PR #203.
 */
export function getNowLocalNaive(timeZone: string): { naive: string; weekday: string; weekdayNum: number } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const naive = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
  // Dia da semana como número (0=domingo..6=sábado, mesma convenção de
  // BusinessHours) — derivado da data já resolvida no fuso certo, nunca de
  // `new Date().getDay()` direto (esse pegaria o fuso do processo Node, que
  // no Render não é America/Asuncion). Date.UTC com um Y-M-D "ingênuo" é
  // seguro aqui porque dia-da-semana é só uma propriedade do calendário —
  // não depende de fuso/hora, só de já termos resolvido o Y-M-D certo antes.
  const weekdayNum = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day))).getUTCDay();
  return { naive, weekday: map.weekday, weekdayNum };
}

/**
 * Achado real em produção (teste ao vivo, domingo 17:37 — expediente de
 * domingo termina às 17:00): o agente sugeriu "podemos verificar um horário
 * para hoje" já com o estúdio fechado. Causa raiz: nem o prompt de ferramentas
 * nem o prompt do especialista (o que de fato escreve a mensagem pro cliente)
 * sabiam o expediente de hoje — só a ferramenta verificar_disponibilidade
 * checa isso, e o modelo só chama ferramenta quando já tem uma data/hora
 * específica, então uma pergunta vaga como "posso hoje?" nunca passava por
 * nenhum checador real antes de virar texto. Calculado sempre que o roteador
 * classifica como "agendamento", esteja ou não uma ferramenta prestes a
 * rodar nesta mensagem.
 */
function describeBusinessHoursToday(hours: BusinessHours | null, naive: string, weekdayNum: number): string {
  const nowHHmm = naive.slice(11, 16);
  if (!hours) return '';
  const today = hours[String(weekdayNum)];
  if (!today) {
    return 'Hoje o estúdio NÃO tem expediente configurado (dia de folga) — nunca ofereça nem confirme horário pra hoje, só pra outro dia.';
  }
  const isOpenNow = nowHHmm >= today.open && nowHHmm < today.close;
  if (isOpenNow) {
    return `Hoje o expediente é ${today.open}–${today.close} — agora são ${nowHHmm}, dentro do horário de atendimento.`;
  }
  const motivo = nowHHmm < today.open ? 'ainda não abriu hoje' : 'já fechou por hoje';
  return `Hoje o expediente é ${today.open}–${today.close} — agora são ${nowHHmm}, ${motivo}. NUNCA ofereça nem confirme "hoje" como opção de horário — sugira diretamente o próximo dia com expediente disponível.`;
}

const DATA_HORA_PARAM_DESCRIPTION = `Data e hora LOCAL (fuso ${BUSINESS_TIMEZONE}), formato "YYYY-MM-DDTHH:mm:ss", SEM offset UTC. Ex: "2026-08-06T15:00:00".`;

/** Usada só quando consultar_disponibilidade_semana é chamada sem um serviço reconhecido no catálogo (sem durationMinutes cadastrado) — valor conservador (1h), nunca 0 nem um número inventado maior. */
const DEFAULT_SLOT_DURATION_MINUTES = 60;

/** Issue #289 (decisão do dono do produto, 18/08/2026) — quanto tempo uma reserva feita por criar_agendamento fica válida sem evento real no Calendar, esperando o comprovante ser aprovado, antes de expirar (ver heldAppointmentExpiryJob.ts). */
const HOLD_EXPIRY_MS = 2 * 60 * 60 * 1000;

/**
 * Ferramentas reais de agenda expostas ao agente de agendamento via
 * function-calling do Gemini. Nenhuma delas recebe um "evento_id" do
 * modelo — remarcar/cancelar sempre resolvem o evento certo a partir do
 * telefone de quem está conversando (server/services/appointmentStore.ts),
 * pra nunca depender do modelo "lembrar" ou inventar um ID.
 */
const AGENDAMENTO_TOOLS: FunctionDeclaration[] = [
  {
    name: 'consultar_disponibilidade_semana',
    description: 'Descobre quais dos horários PADRÃO do estúdio (08:30, 13:30, 16:30 — e 18:30 só se o cliente pedir algo depois das 16:30) estão realmente livres nos próximos 7 dias, respeitando o horário de atendimento do negócio e a agenda real do Google Calendar — use isso ANTES de oferecer um horário específico ao cliente, em vez de verificar_disponibilidade um horário por vez adivinhado. Se não vier nenhum dia na resposta, nenhum dos horários padrão está livre essa semana — nunca invente um horário fora do que essa ferramenta retornou.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        servico: { type: Type.STRING, description: 'Nome EXATO do serviço/procedimento, igual ao catálogo — usado pra calcular a duração real de cada horário. Se omitido, usa uma duração padrão conservadora.' },
      },
      required: [],
    },
  },
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
  {
    name: 'criar_pre_reserva',
    description: 'Registra uma pré-reserva REAL (visível pra qualquer operador, não só uma promessa em texto) quando a cliente se compromete expressamente com uma data específica pra transferir a seña, mas ainda não pagou. NÃO cria evento na agenda nem reserva o horário de verdade — só um lembrete de follow-up. Nunca chame sem a cliente ter dado uma data específica.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        servico: { type: Type.STRING, description: 'Nome do serviço combinado, igual ao catálogo.' },
        data_combinada: { type: Type.STRING, description: 'Data em que a cliente disse que vai transferir a seña, formato "YYYY-MM-DD".' },
      },
      required: ['servico', 'data_combinada'],
    },
  },
];

/**
 * Dispara o Meta CAPI (Epic 4.5.6 — evento "Schedule" ao criar agendamento;
 * [TRÁFEGO] CAPI — evento "Purchase" quando a seña é verificada) — nunca
 * bloqueia o fluxo do agente (sempre chamado sem await pelo chamador). Só
 * dispara se a conversa tiver um ctwa_clid real gravado (veio de um anúncio
 * Clique-para-WhatsApp — ver conversationStore.attachAdReferralIfMissing) e
 * se o tenant tiver credencial de CAPI configurada; qualquer uma das duas
 * ausente e não dispara nada, silenciosamente.
 */
async function notifyMetaCapiEvent(tenantId: string, phone: string, eventName: string, titulo: string): Promise<void> {
  const ctwaClid = await getConversationCtwaClid(tenantId, phone);
  if (!ctwaClid) return;

  const kb = await getKnowledgeBase(tenantId);
  const value = resolveProductAmountByName(kb, titulo);

  await fireMetaCapiEventForTenant(tenantId, {
    eventName,
    phone,
    ctwaClid,
    value: value || undefined,
    contentName: titulo,
  });
}

async function notifyBookingCompleted(tenantId: string, phone: string, titulo: string): Promise<void> {
  return notifyMetaCapiEvent(tenantId, phone, 'Schedule', titulo);
}

/** "YYYY-MM-DDTHH:mm:ss" -> "HH:mm", zero-padded — mesmo formato usado na validação anti-alucinação (Epic 4.5.7). */
function extractHHmm(naiveIso: string): string {
  return naiveIso.slice(11, 16);
}

/**
 * Soma minutos a uma data/hora LOCAL naive ("YYYY-MM-DDTHH:mm:ss", sem
 * offset — mesmo formato de DATA_HORA_PARAM_DESCRIPTION). Trata a string
 * como UTC só pra fazer a aritmética de calendário (nunca converte fuso de
 * verdade) — cruza hora/dia corretamente sem risco de bug de DST.
 */
function addMinutesToNaiveIso(naiveIso: string, minutes: number): string {
  const d = new Date(`${naiveIso}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

/**
 * Fim REAL do evento a partir da duração cadastrada no catálogo pro
 * serviço — nunca o `data_hora_fim`/`nova_data_hora_fim` que o próprio
 * modelo calculou. Achado real em produção (18/08/2026): mesmo com
 * `consultar_disponibilidade_semana` já usando a duração certa pra listar
 * horários livres, nada impedia o modelo de errar a conta na hora de
 * CRIAR o evento (ex: agendar só 1h de um serviço de 3h) — o evento real
 * no Google Calendar ficava mais curto que o serviço de verdade, deixando
 * o restante do horário aparecer como livre pra outro cliente com o MESMO
 * profissional. Duração desconhecida no catálogo cai no mesmo fallback
 * conservador (1h) já usado em consultar_disponibilidade_semana.
 */
function resolveAuthoritativeEndIso(kb: AgentKnowledgeBase | null, servico: string, startIso: string): string {
  const durationMinutes = findProductDurationMinutes(kb, servico) ?? DEFAULT_SLOT_DURATION_MINUTES;
  return addMinutesToNaiveIso(startIso, durationMinutes);
}

/** Extrai todo horário no formato H:mm/HH:mm citado num texto livre, normalizado com zero à esquerda — usado pela validação anti-alucinação (Epic 4.5.7). */
function extractCitedTimes(text: string): string[] {
  const matches = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || [];
  return matches.map((m) => {
    const [h, mm] = m.split(':');
    return `${h.padStart(2, '0')}:${mm}`;
  });
}

/**
 * Gate determinístico pra reembolso/desconto (15/08/2026) — mesmo espírito
 * do gate anti-alucinação de horário (Epic 4.5.7) e da regra "toda
 * reclamação escala pra humano" (Epic 4.5.8), mas cobrindo uma lacuna real:
 * `needsHumanConfirmation` forçado em `reclamacao` só GERA um alerta pro
 * operador em paralelo — não impede o texto que o modelo escreveu de sair
 * pro cliente na hora. Sem ferramenta nenhuma de reembolso/desconto neste
 * sistema (diferente de agenda, que tem `criar_agendamento` real pra
 * confirmar um horário), QUALQUER promessa de reembolso/desconto/cortesia
 * citada pelo modelo numa reclamação é, por definição, não confirmada —
 * nunca há uma "ferramenta que rodou" capaz de sustentar essa promessa.
 * Escopo deliberadamente restrito ao agente `reclamacao`: uma resposta de
 * FAQ recitando a política de reembolso já cadastrada na Base de
 * Conhecimento (ex: "cancelamento com 24h+ de antecedência tem reembolso")
 * não é uma promessa nova, é informação real — nunca deve ser bloqueada.
 */
const CONCESSION_PROMISE_PATTERNS = [
  /reembols/i, // reembolso, reembolsar, reembolsado, reembolsamos
  /devolv\w*\s+(o\s+)?(dinheiro|dinero|valor|importe)/i, // devolver o dinheiro / devolver tu dinero
  /descont\w*/i, // desconto, descuento, descontar, descontamos
  /\bgr[aá]tis\b/i,
  /\bgratuit[oa]\b/i,
  /cortes[ií]a/i,
  /\bsem custo\b/i,
  /\bsin costo\b/i,
];

/** true quando o texto cita uma promessa de reembolso/desconto/cortesia — ver comentário acima. */
function containsUnauthorizedConcessionPromise(text: string): boolean {
  return CONCESSION_PROMISE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Gate determinístico pra confirmação prematura de agendamento (16/08/2026,
 * "Opção A" — ver docs/AGENTE-VERTICAL-ARQUITETURA.md seção 4.3). Desde a
 * issue #289 (18/08/2026) `criar_agendamento` não cria mais o evento REAL no
 * Google Calendar direto — só reserva o horário (`payment_status =
 * 'awaiting_payment'`, sem eventId) até um operador aprovar o comprovante
 * (ver attachCalendarEventToHold em appointmentStore.ts). O risco que este
 * gate corrige continua o mesmo: o cliente ser informado que o turno está
 * "confirmado" enquanto o pagamento ainda não foi aprovado por um operador
 * (ou já foi rejeitado). Mesmo padrão do gate de reembolso/desconto acima:
 * corrige o texto ANTES de sair, nunca só alerta em paralelo.
 * Escopo restrito a paymentStatus 'awaiting_payment', 'pending_verification'
 * ou 'rejected' — um paymentStatus ausente (null/undefined) é ambíguo entre
 * "reserva combinada em efetivo, sem sinal" e "sinal exigido mas comprovante
 * ainda não chegou" (caso legado, de antes da issue #289, ou reserva sem
 * sinal), e o sistema não tem hoje nenhum sinal pra distinguir os dois
 * casos, então gatear em cima de null arriscaria bloquear confirmações
 * legítimas de reserva em efetivo.
 */
const CONFIRMATION_CLAIM_PATTERNS = [
  /tu turno (ya )?(está|esta) confirmad[oa]/i,
  /el pago (fue|ha sido) aprobado/i,
  /ya est[áa] agendad[oa]/i,
  /el horario es tuyo/i,
  /(agendamento|hor[áa]rio|turno|reserva) (est[áa] )?confirmad[oa]/i,
  /confirmad[oa] (tu|o seu) (turno|agendamento|hor[áa]rio)/i,
];

/** true quando o texto afirma que o turno/agendamento já está confirmado — ver comentário acima. */
function containsPrematureBookingConfirmation(text: string): boolean {
  return CONFIRMATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

async function executeCalendarTool(
  tenantId: string,
  name: string,
  args: Record<string, any>,
  phone: string,
  cfg: CalendarConfig,
  kb: AgentKnowledgeBase | null,
  contactName?: string,
  messageId?: string
): Promise<{ response: Record<string, unknown>; summary: string; confirmedTimesHHmm?: string[] }> {
  try {
    switch (name) {
      case 'consultar_disponibilidade_semana': {
        // Duração real do serviço (Etapa 2) quando reconhecido no catálogo;
        // caso contrário, duração padrão conservadora — nunca um número
        // maior inventado, que poderia esconder slots livres de verdade.
        const durationMinutes = (args.servico && findProductDurationMinutes(kb, args.servico)) || DEFAULT_SLOT_DURATION_MINUTES;
        const days = await findWeeklyAvailability(tenantId, cfg, durationMinutes, BUSINESS_TIMEZONE);
        // Pedido real do dono do produto (20/08/2026) — depois de várias
        // tentativas só de PROMPT (instruir "no máximo 2-3 horários") que o
        // modelo às vezes ignorava numa resposta real, trava a ferramenta
        // em si num "menu" fixo de horários padrão em vez de devolver TODO
        // slot de 30min livre no expediente (que já chegou a passar de 100
        // horários numa semana vazia). Isso é determinístico: o modelo
        // fisicamente não recebe (nem pode citar) nenhum horário fora dessa
        // lista — o gate anti-alucinação corrige sozinho se ele tentar. A
        // ferramenta faz a checagem real de disponibilidade só desses
        // horários padrão, e só devolve os que estiverem livres de verdade.
        const STANDARD_OFFER_TIMES = ['08:30', '13:30', '16:30', '18:30'];
        const curatedDays = days
          .map((d) => ({ date: d.date, slots: d.slots.filter((s) => STANDARD_OFFER_TIMES.includes(s.start)) }))
          .filter((d) => d.slots.length > 0);
        const allTimes = curatedDays.flatMap((d) => d.slots.map((s) => s.start));
        return {
          response: {
            dias_disponiveis: curatedDays,
            aviso: 'Só oferece os 3 horários padrão do estúdio por dia: 08:30 (manhã), 13:30 ou 16:30 (tarde) — nessa ordem de preferência. NUNCA ofereça 18:30 de primeira; só mencione esse horário se o cliente pedir explicitamente algo depois das 16:30.',
          },
          summary: curatedDays.length
            ? `Consultou disponibilidade da semana (duração ${durationMinutes}min, horários padrão 08:30/13:30/16:30/18:30): ${curatedDays.map((d) => `${d.date} (${d.slots.map((s) => s.start).join(', ')})`).join('; ')}.`
            : `Consultou disponibilidade da semana (duração ${durationMinutes}min): nenhum dos horários padrão (08:30/13:30/16:30/18:30) está livre essa semana.`,
          confirmedTimesHHmm: allTimes.length ? allTimes : undefined,
        };
      }
      case 'verificar_disponibilidade': {
        const disponivel = await checkFreeBusy(tenantId, cfg, args.data_hora_inicio, args.data_hora_fim, BUSINESS_TIMEZONE);
        return {
          response: { disponivel },
          summary: `Verificou disponibilidade em ${args.data_hora_inicio}–${args.data_hora_fim}: ${disponivel ? 'LIVRE' : 'OCUPADO'}.`,
          confirmedTimesHHmm: disponivel ? [extractHHmm(args.data_hora_inicio)] : undefined,
        };
      }
      case 'criar_agendamento': {
        // Etapa 2 — achado no catálogo real: itens como "Retoque" só devem
        // ser marcados depois da Monique avaliar o resultado, nunca por
        // pedido direto do cliente. bookable:false no produto bloqueia isso
        // aqui, na ferramenta real, em vez de depender só do modelo seguir a
        // regra em texto.
        if (isNonBookableProduct(kb, args.titulo)) {
          return {
            response: { erro: `"${args.titulo}" não é um serviço agendável diretamente — só Monique decide isso depois de avaliar o resultado. Explique pro cliente e encaminhe pra atendimento humano, nunca crie esse agendamento.` },
            summary: `Tentou agendar "${args.titulo}" diretamente, mas esse item não é agendável por si só (precisa de avaliação humana antes) — recusado.`,
          };
        }
        // Achado numa auditoria pós-lançamento: sem essa checagem, um
        // segundo criar_agendamento pro mesmo telefone sobrescrevia
        // silenciosamente o eventId rastreado do primeiro (a tabela é
        // chaveada por tenant_id+phone) — o evento antigo ficava órfão na
        // agenda real (continua ocupando o horário, mas remarcar_agendamento/
        // cancelar_agendamento/o job de lembretes só enxergam o novo).
        //
        // Achado real em produção (12/08, cliente recorrente): essa checagem
        // não distinguia um agendamento REALMENTE ativo de um que já
        // aconteceu no passado — nada nunca limpa a linha depois que a data
        // passa (só cancelar_agendamento limpa, e só no fluxo de <24h). Uma
        // cliente que já teve um serviço atendido e pago, e volta por um
        // serviço NOVO e diferente, caía sempre em remarcar_agendamento por
        // engano: o evento real no Google Calendar ficava com o título do
        // serviço VELHO (rescheduleCalendarEvent só muda data/hora, nunca o
        // título) e o operador via o status de pagamento do ciclo antigo no
        // painel. Só um agendamento cujo horário ainda não passou bloqueia
        // um criar_agendamento novo.
        //
        // Tudo isso roda dentro do lock por tenant (Opção A, 16/08/2026, ver
        // perTenantCalendarLock.ts) — sem ele, duas mensagens quase
        // simultâneas (do mesmo cliente ou de dois clientes disputando o
        // mesmo horário) podiam checar disponibilidade e criar o evento em
        // paralelo, e as duas "ganhavam" a mesma vaga.
        return await runExclusiveForTenant(tenantId, async () => {
          const existingBeforeCreate = await getAppointmentForPhone(tenantId, phone);
          const { naive: nowNaiveForCheck } = getNowLocalNaive(BUSINESS_TIMEZONE);
          const existingIsUpcoming = existingBeforeCreate && Date.parse(`${existingBeforeCreate.endIso}Z`) > Date.parse(`${nowNaiveForCheck}Z`);
          if (existingIsUpcoming) {
            return {
              response: { erro: 'Este contato já tem um agendamento ativo — use remarcar_agendamento pra mudar o horário, nunca criar_agendamento de novo.' },
              summary: `Tentou criar um agendamento novo, mas este contato já tem um ativo ("${existingBeforeCreate!.summary}" em ${existingBeforeCreate!.startIso}) — precisa remarcar em vez de criar outro.`,
            };
          }
          // Gate de pagamento (16/08/2026, ver docs/AGENTE-VERTICAL-ARQUITETURA.md
          // seção 4.3 / issue #279) — nunca deixar um criar_agendamento novo
          // APAGAR silenciosamente um ciclo de pagamento ainda não resolvido
          // do mesmo telefone: se o agendamento/reserva antigo já tinha
          // passado da data (existingIsUpcoming = false), nada impedia
          // resetPaymentState:true sobrescrever um comprovante ainda
          // "awaiting_payment"/"pending_verification"/"rejected" sem humano
          // nenhum ter decidido esse caso, perdendo o rastro pra sempre.
          const existingHasUnresolvedPayment = existingBeforeCreate && (
            existingBeforeCreate.paymentStatus === 'awaiting_payment'
            || existingBeforeCreate.paymentStatus === 'pending_verification'
            || existingBeforeCreate.paymentStatus === 'rejected'
          );
          if (existingHasUnresolvedPayment) {
            return {
              response: { erro: 'Este contato tem um comprovante de pagamento de um agendamento anterior ainda sem resolução humana — não crie nem remarque nada, isso precisa de um operador decidindo o caso antes.' },
              summary: `Tentou criar um agendamento novo, mas este contato tem um pagamento de um ciclo anterior ainda não resolvido (status "${existingBeforeCreate!.paymentStatus}", agendamento "${existingBeforeCreate!.summary}") — recusado, precisa de decisão humana antes de qualquer novo agendamento.`,
            };
          }
          // Fim REAL calculado a partir da duração cadastrada — nunca o
          // data_hora_fim que o modelo mandou (ver resolveAuthoritativeEndIso
          // acima). Loga quando o modelo errou a conta, só pra visibilidade.
          const authoritativeEndIso = resolveAuthoritativeEndIso(kb, args.titulo, args.data_hora_inicio);
          if (authoritativeEndIso !== args.data_hora_fim) {
            console.warn(`⚠️  [Agendamento] tenant=${tenantId} data_hora_fim do modelo ("${args.data_hora_fim}") não batia com a duração real de "${args.titulo}" — corrigido pra "${authoritativeEndIso}".`);
          }
          // Reconsulta de disponibilidade dentro do lock, imediatamente antes
          // de reservar o horário: o modelo pode ter chamado
          // verificar_disponibilidade minutos antes na mesma conversa, mas
          // nada garantia que o horário continuava livre no instante exato
          // da reserva — outra conversa podia ter ocupado o slot nesse
          // meio-tempo. Usa o fim CORRIGIDO acima, não o do modelo.
          const stillFree = await checkFreeBusy(tenantId, cfg, args.data_hora_inicio, authoritativeEndIso, BUSINESS_TIMEZONE);
          if (!stillFree) {
            return {
              response: { erro: 'Esse horário acabou de ficar ocupado — consulte a disponibilidade de novo antes de tentar criar o agendamento.' },
              summary: `Tentou criar o agendamento "${args.titulo}" para ${args.data_hora_inicio}–${authoritativeEndIso}, mas a reconsulta de disponibilidade feita no momento da criação encontrou o horário OCUPADO — não criou, é preciso reconsultar disponibilidade.`,
            };
          }
          // Issue #289 (decisão do dono do produto, 18/08/2026) — reduz (não
          // elimina) o risco de dois clientes disputarem o mesmo horário
          // enquanto o primeiro ainda não pagou: como o horário só fica
          // reservado aqui (sem evento real ainda), checkFreeBusy sozinho não
          // vê outra reserva concorrente pra esse mesmo intervalo.
          const overlappingHold = await findOverlappingHold(tenantId, phone, args.data_hora_inicio, authoritativeEndIso);
          if (overlappingHold) {
            return {
              response: { erro: 'Esse horário está reservado por outro cliente que ainda está esperando aprovação de pagamento — ofereça um horário alternativo.' },
              summary: `Tentou criar o agendamento "${args.titulo}" para ${args.data_hora_inicio}–${authoritativeEndIso}, mas outro cliente já reservou esse mesmo horário aguardando aprovação de pagamento — não criou, ofereça outro horário.`,
            };
          }
          // Issue #289 (decisão do dono do produto, 18/08/2026): NÃO cria mais
          // o evento real no Google Calendar aqui — só reserva o horário
          // (payment_status 'awaiting_payment', sem eventId) por até
          // HOLD_EXPIRY_MS enquanto aguarda o comprovante. O evento real só é
          // criado quando um operador aprova o pagamento (ver
          // attachCalendarEventToHold, POST /verify-payment em
          // conversations.ts) — nunca antes disso.
          const heldUntil = new Date(Date.now() + HOLD_EXPIRY_MS).toISOString();
          await createAppointmentHold(tenantId, phone, { summary: args.titulo, startIso: args.data_hora_inicio, endIso: authoritativeEndIso, heldUntil });
          notifyBookingCompleted(tenantId, phone, args.titulo).catch(() => {});
          return {
            response: { sucesso: true, aguardando_pagamento: true },
            summary: `Reservou o horário "${args.titulo}" para ${args.data_hora_inicio}–${authoritativeEndIso}, aguardando o comprovante de pagamento ser enviado e aprovado por um operador — ainda NÃO é um agendamento confirmado, diga isso claramente pro cliente.`,
            confirmedTimesHHmm: [extractHHmm(args.data_hora_inicio)],
          };
        });
      }
      case 'remarcar_agendamento': {
        // Mesmo lock por tenant e mesma reconsulta de disponibilidade que
        // criar_agendamento acima (Opção A, 16/08/2026) — antes desta
        // correção, remarcar_agendamento não fazia NENHUMA checagem de
        // disponibilidade, uma lacuna maior que a de criar_agendamento.
        return await runExclusiveForTenant(tenantId, async () => {
          const existing = await getAppointmentForPhone(tenantId, phone);
          if (!existing) {
            return {
              response: { erro: 'Nenhum agendamento ativo encontrado pra este contato.' },
              summary: 'Tentou remarcar mas não há nenhum agendamento ativo registrado pra este contato.',
            };
          }
          // Mesma correção de duração de criar_agendamento acima — o serviço
          // continua sendo o do agendamento existente (remarcar_agendamento
          // não muda o título), só o horário muda.
          const authoritativeEndIso = resolveAuthoritativeEndIso(kb, existing.summary, args.nova_data_hora_inicio);
          if (authoritativeEndIso !== args.nova_data_hora_fim) {
            console.warn(`⚠️  [Agendamento] tenant=${tenantId} nova_data_hora_fim do modelo ("${args.nova_data_hora_fim}") não batia com a duração real de "${existing.summary}" — corrigido pra "${authoritativeEndIso}".`);
          }
          const stillFree = await checkFreeBusy(tenantId, cfg, args.nova_data_hora_inicio, authoritativeEndIso, BUSINESS_TIMEZONE);
          if (!stillFree) {
            return {
              response: { erro: 'Esse novo horário acabou de ficar ocupado — consulte a disponibilidade de novo antes de tentar remarcar.' },
              summary: `Tentou remarcar para ${args.nova_data_hora_inicio}–${authoritativeEndIso}, mas a reconsulta de disponibilidade feita no momento da remarcação encontrou o horário OCUPADO — não remarcou, é preciso reconsultar disponibilidade.`,
            };
          }
          // Issue #289 — sem evento real ainda (reserva aguardando
          // pagamento), remarcar só muda o horário reservado, sem tocar no
          // Calendar. Mesma checagem de reserva concorrente de outro
          // telefone de criar_agendamento acima.
          if (!existing.eventId) {
            const overlappingHold = await findOverlappingHold(tenantId, phone, args.nova_data_hora_inicio, authoritativeEndIso);
            if (overlappingHold) {
              return {
                response: { erro: 'Esse horário está reservado por outro cliente que ainda está esperando aprovação de pagamento — ofereça um horário alternativo.' },
                summary: `Tentou remarcar a reserva pra ${args.nova_data_hora_inicio}–${authoritativeEndIso}, mas outro cliente já reservou esse mesmo horário aguardando aprovação de pagamento — não remarcou, ofereça outro horário.`,
              };
            }
          } else {
            await rescheduleCalendarEvent(tenantId, cfg, existing.eventId, args.nova_data_hora_inicio, authoritativeEndIso, BUSINESS_TIMEZONE);
          }
          await setAppointmentForPhone(tenantId, phone, { ...existing, startIso: args.nova_data_hora_inicio, endIso: authoritativeEndIso });
          return {
            response: { sucesso: true },
            summary: `Remarcou o agendamento existente para ${args.nova_data_hora_inicio}–${authoritativeEndIso} com sucesso.`,
            confirmedTimesHHmm: [extractHHmm(args.nova_data_hora_inicio)],
          };
        });
      }
      case 'cancelar_agendamento': {
        const existing = await getAppointmentForPhone(tenantId, phone);
        if (!existing) {
          return {
            response: { erro: 'Nenhum agendamento ativo encontrado pra este contato.' },
            summary: 'Tentou cancelar mas não há nenhum agendamento ativo registrado pra este contato.',
          };
        }
        // Issue #289 — uma reserva ainda sem evento real (aguardando
        // pagamento) nunca teve sinal transferido de verdade, então não há
        // devolução em jogo nenhuma — a política de 24h abaixo só se aplica
        // a um agendamento que já tem evento real (ciclo de pagamento em
        // andamento ou concluído). Cancela direto, sem escalar.
        if (!existing.eventId) {
          await clearAppointmentForPhone(tenantId, phone);
          return { response: { sucesso: true }, summary: 'Cancelou a reserva existente (ainda sem evento real, aguardando pagamento) com sucesso — sem devolução em jogo, nenhum sinal tinha sido transferido ainda.' };
        }
        // Epic 4.5.9 — política real de sinal (ver knowledge_base/pricingAndPolicies):
        // devolvido com 24h+ de antecedência, não devolvido com menos. Como o
        // Universo ainda não rastreia se o sinal foi pago de fato (isso é a
        // Etapa 8, pendente), a decisão de devolução nunca pode ser tomada
        // sozinha pela IA — com 24h+ de antecedência, o cancelamento NÃO é
        // executado automaticamente, só escalado pra um humano decidir. Com
        // menos de 24h não há devolução em jogo, então a IA cancela direto.
        const { naive: nowNaive } = getNowLocalNaive(BUSINESS_TIMEZONE);
        const hoursUntilAppointment = (Date.parse(`${existing.startIso}Z`) - Date.parse(`${nowNaive}Z`)) / 3_600_000;
        if (hoursUntilAppointment >= 24) {
          return {
            response: { escalonar: true, motivo: 'cancelamento_com_mais_de_24h_de_antecedencia' },
            summary: `Cliente pediu cancelamento do agendamento de ${existing.startIso} — mais de 24h de antecedência, a política de devolução do sinal exige decisão humana. NÃO cancelou automaticamente; um operador precisa confirmar e cancelar manualmente se for o caso.`,
          };
        }
        await cancelCalendarEvent(tenantId, cfg, existing.eventId);
        await clearAppointmentForPhone(tenantId, phone);
        return { response: { sucesso: true }, summary: 'Cancelou o agendamento existente com sucesso (menos de 24h de antecedência — sem devolução de sinal pela política).' };
      }
      case 'criar_pre_reserva': {
        // Etapa 2 — achado numa auditoria: antes disso a IA só "prometia em
        // texto" ("te dejo pre-reservado"), sem registrar nada real em
        // nenhum lugar — nenhum operador via essa promessa, e não existia
        // job de follow-up possível porque não havia dado nenhum pra
        // consultar. Agora vira uma linha real em pre_reservations (Etapa 1),
        // idempotente por wa_message_id.
        if (!messageId) {
          return {
            response: { erro: 'Não foi possível registrar a pré-reserva agora — identificador de mensagem ausente.' },
            summary: 'Tentou criar pré-reserva mas faltou o identificador da mensagem — não registrada, não prometa a pré-reserva pro cliente.',
          };
        }
        const preReservation = await createPreReservation(tenantId, {
          phone,
          contactName,
          serviceName: args.servico,
          committedDate: args.data_combinada,
          waMessageId: messageId,
        });
        return {
          response: { sucesso: true, pre_reserva_id: preReservation.id },
          summary: `Registrou pré-reserva de "${args.servico}" com data combinada ${args.data_combinada} — confirmação definitiva ainda depende da transferência da seña.`,
        };
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
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  contactName?: string,
  messageId?: string
): Promise<{ actionsSummary: string[]; hadError: boolean; confirmedTimes: string[]; businessHoursStatus?: string }> {
  const { naive, weekday, weekdayNum } = getNowLocalNaive(BUSINESS_TIMEZONE);
  // Best-effort: uma falha aqui é só um enriquecimento de prompt (aviso de
  // horário de funcionamento) — nunca pode derrubar o fluxo real de agenda.
  const businessHours = await getTenantBusinessHours(tenantId).catch(() => null);
  const businessHoursStatus = describeBusinessHoursToday(businessHours, naive, weekdayNum);

  // Achado direto do dono do produto: um agendamento já criado (linha real
  // em appointmentStore, fato do nosso próprio banco) não pode virar
  // "não confirmado" só porque a checagem de conectividade AO VIVO com o
  // Google Calendar teve um problema pontual nesta mensagem — a agenda já
  // fez o trabalho dela quando criou o evento; uma falha passageira de
  // conectividade não desfaz isso. Por isso a busca do agendamento ativo (e
  // o confirmedTimes que vem dela) roda ANTES da checagem de `connected` e
  // vale nos dois casos (conectado ou não).
  const existing = await getAppointmentForPhone(tenantId, phone);
  const confirmedTimesFromExisting: string[] = existing ? [extractHHmm(existing.startIso)] : [];

  const connected = await isGoogleCalendarConnected(tenantId);
  if (!connected) {
    return { actionsSummary: [], hadError: false, confirmedTimes: confirmedTimesFromExisting, businessHoursStatus };
  }

  const historyText = buildHistoryText(history);
  const kb = await getKnowledgeBase(tenantId);
  // Etapa 2 — achado numa auditoria: antes disso TODO agendamento caía num
  // fallback fixo de "90 minutos" no prompt, mesmo pra serviços de 30min
  // (Diseño con Henna) ou 180min (Combo Triple) — bloqueando a agenda real
  // errado. Agora usa a duração real cadastrada por serviço quando existir.
  const durationsList = (kb?.products || [])
    .filter((p) => p.durationMinutes)
    .map((p) => `- ${p.name}: ${p.durationMinutes}min`)
    .join('\n');
  // O horário do agendamento ATIVO (se houver) é um fato conhecido de antemão
  // — citar ele numa confirmação de cancelamento/remarcação não é alucinação.
  // (já calculado acima, antes da checagem de `connected` — reaproveita aqui.)
  const confirmedTimes: string[] = [...confirmedTimesFromExisting];

  // Etapa 8 (fluxo de verificação de pagamento) — o estado é sempre decidido
  // por um operador humano (webhooks.ts marca pending_verification quando
  // chega uma imagem; server/routes/conversations.ts, próximo passo, é onde
  // o operador marca verified/rejected). A IA só transiciona verified ->
  // confirmed, que é o gatilho pra ela poder dizer "confirmado" pro cliente
  // — nunca decide "verificado" sozinha.
  const actionsSummary: string[] = [];
  if (existing?.paymentStatus === 'pending_verification') {
    actionsSummary.push('Comprovante de pagamento recebido, ainda aguardando verificação de um operador — NÃO confirme o turno como pago, diga que vai verificar com cuidado.');
  } else if (existing?.paymentStatus === 'rejected') {
    actionsSummary.push('O comprovante enviado foi rejeitado por um operador — NÃO confirme o turno, oriente o cliente a reenviar um comprovante válido ou aguardar contato.');
  } else if (existing?.paymentStatus === 'verified') {
    // [TRÁFEGO] CAPI: a Meta deve otimizar pra "cliente pagou", não só pra
    // "conseguiu agendar" (o único evento existente até aqui era Schedule,
    // disparado na criação do agendamento — risco de agendamento fantasma
    // conforme o volume de anúncio crescer). Só dispara quando confirmPayment
    // realmente efetuou a transição agora (evita duplicar se essa checagem
    // rodar de novo numa corrida e a linha já não estiver mais 'verified').
    //
    // Issue #182 — agendamento cadastrado manualmente pelo operador
    // (source: 'manual', fechado fora da IA — WhatsApp pessoal, telefone,
    // presencial) nunca dispara Purchase: não carrega origem de anúncio
    // rastreável, contaria como venda "sem origem" e distorceria a métrica
    // de atribuição de tráfego pago (decisão do dono do produto, 12/08/2026).
    const confirmed = await confirmPayment(tenantId, phone);
    if (confirmed && confirmed.source !== 'manual') {
      notifyMetaCapiEvent(tenantId, phone, 'Purchase', confirmed.summary).catch(() => {});
    }
    actionsSummary.push('Pagamento verificado por um operador agora mesmo — pode confirmar o turno pro cliente com segurança.');
  }

  const prompt = `Você controla a agenda real de um negócio de estética/micropigmentação através de ferramentas. O cliente quer marcar, remarcar ou cancelar um horário.

Data e hora ATUAL (fuso ${BUSINESS_TIMEZONE}): ${naive} (${weekday}).
${businessHoursStatus}
${existing ? `Este contato já tem um agendamento ativo: "${existing.summary}" começando em ${existing.startIso} (fuso ${BUSINESS_TIMEZONE}).` : 'Este contato não tem nenhum agendamento ativo no momento.'}
${historyText ? `Histórico recente da conversa:\n${historyText}\n` : ''}
Mensagem do cliente: "${text}"

Duração real de cada serviço (use pra calcular data_hora_fim — nunca invente uma duração diferente da cadastrada):
${durationsList || '(nenhuma duração cadastrada pra nenhum serviço — pergunte a duração pra cliente ou use 90 minutos como estimativa)'}

Regras:
- Sempre passe datas/horas no formato "YYYY-MM-DDTHH:mm:ss" (hora local, SEM offset), fuso ${BUSINESS_TIMEZONE}.
- Se faltar informação essencial pra agir (dia/horário desejado), NÃO chame nenhuma ferramenta.
- Antes de criar um agendamento novo, verifique disponibilidade primeiro; só crie se estiver livre.
- Horários padrão do estúdio pra oferecer: 08:30 (manhã), 13:30 ou 16:30 (tarde) — consultar_disponibilidade_semana já só devolve esses (checados contra a agenda real). NUNCA ofereça 18:30 de primeira; só mencione se o cliente pedir explicitamente algo depois das 16:30.
- Se a cliente se comprometer com uma data específica pra transferir a seña mas ainda não pagou, chame criar_pre_reserva — isso NUNCA substitui criar_agendamento, é só um registro de follow-up.
- Pra remarcar/cancelar, você NÃO precisa saber o ID do evento — as ferramentas já resolvem isso sozinhas a partir deste contato.`;

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
  let hadError = false;

  for (let i = 0; i < 4; i++) {
    const response = await withGeminiRetryAndUsage(
      tenantId,
      'agendamento',
      () =>
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
      const { response: toolResponse, summary, confirmedTimesHHmm } = await executeCalendarTool(tenantId, call.name || '', call.args || {}, phone, cfg, kb, contactName, messageId);
      actionsSummary.push(summary);
      // 'escalonar' (Epic 4.5.9, cancelamento com 24h+ de antecedência) reaproveita
      // o mesmo caminho de needsHumanConfirmation que 'erro' já usa.
      if ('erro' in toolResponse || 'escalonar' in toolResponse) hadError = true;
      if (confirmedTimesHHmm) confirmedTimes.push(...confirmedTimesHHmm);
      responseParts.push({ functionResponse: { name: call.name, response: toolResponse } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { actionsSummary, hadError, confirmedTimes, businessHoursStatus };
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
  {
    name: 'enviar_video_exemplo',
    description: 'Envia pro cliente, como vídeo real no WhatsApp, o vídeo de exemplo de um serviço específico do catálogo (já cadastrado na Base de Conhecimento) — geralmente até ~1 minuto, mostra o procedimento/resultado de verdade, mais persuasivo que uma foto parada.',
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
 * Ferramenta nova (Epic 4.5.2, paridade com o projeto antigo da Monique;
 * vídeo adicionado depois, mesmo espírito): decide se a mensagem do cliente
 * pede/justifica mandar a foto OU o vídeo de exemplo de um serviço
 * específico e, se sim, envia de verdade via Meta Cloud API (mesmo upload
 * usado no envio manual do painel, `server/routes/conversations.ts`
 * `/send-example-photo` e `/send-example-video`). Chamada só uma vez por
 * mensagem recebida (não é um loop como `runAgendamentoTools`) e executa no
 * máximo 1 chamada de ferramenta — nunca manda mais de 1 mídia pra mesma
 * mensagem do cliente. Limite de "no máximo 1 mídia por conversa inteira",
 * se algum tenant precisar, é regra de negócio dele (Base de Conhecimento,
 * `businessRules` — ver Clic Piscinas), não está garantido aqui.
 */
/** Ações válidas que o Groq (ou o Gemini) pode decidir em runMidiaTool — mesmo enum nos dois caminhos. */
const MIDIA_VALID_ACTIONS = ['enviar_foto_exemplo', 'enviar_video_exemplo', 'nenhuma'] as const;
type MidiaAction = (typeof MIDIA_VALID_ACTIONS)[number];

/** Forma unificada do resultado dessa decisão, venha do function-calling do Gemini ou do JSON do Groq — o resto de runMidiaTool só conhece isso. */
interface MidiaCall {
  name: 'enviar_foto_exemplo' | 'enviar_video_exemplo';
  args: { nome_produto?: string };
}

/**
 * Pedido direto do dono do produto (18/08/2026, mesma decisão do roteador):
 * decidir se manda foto/vídeo de exemplo é baixo risco — o pior caso de um
 * engano é mandar a mídia errada ou nenhuma, nunca criar/cancelar nada real
 * (diferente de runAgendamentoTools, que mexe em agenda/pagamento e por
 * isso continua só no Gemini). Bom candidato pro mesmo padrão
 * Groq-primeiro-Gemini-de-fallback já usado em classifyAgent: 1 única
 * tentativa, timeout curto, qualquer falha (rede, JSON malformado, "action"
 * fora do enum) cai pro Gemini de sempre sem propagar erro.
 */
async function decideMidiaActionViaGroq(
  tenantId: string,
  groqApiKey: string,
  prompt: string
): Promise<MidiaCall | undefined> {
  const { parsed, usage } = await callGroqJsonCompletion(
    groqApiKey,
    `${prompt}\n\nResponda estritamente em formato JSON: { "action": "enviar_foto_exemplo" | "enviar_video_exemplo" | "nenhuma", "nome_produto": "nome EXATO do catálogo, ou string vazia se action for \\"nenhuma\\"" }`
  );
  const action = parsed?.action as MidiaAction;
  if (!MIDIA_VALID_ACTIONS.includes(action)) {
    throw new Error(`Groq retornou "action" fora do enum esperado: ${JSON.stringify(parsed?.action)}`);
  }
  recordGeminiUsage(tenantId, 'foto', usage, 'groq').catch(() => {});
  if (action === 'nenhuma') return undefined;
  return { name: action, args: { nome_produto: (parsed?.nome_produto as string) || '' } };
}

const PHOTO_VIDEO_KEYWORD_RE = /\bfotos?\b|\bimagens?\b|\bv[ií]deos?\b/i;

/**
 * Achado real em produção (20/08/2026, tenant Monique): cliente perguntou
 * "Tiene fotos?" logo depois do agente oferecer 2 serviços sem ela ter
 * escolhido nenhum ainda — a decisão de mídia corretamente decide não
 * enviar nada (não dá pra saber qual produto mandar), mas o especialista,
 * sem NENHUM contexto sobre essa decisão, respondia "no tengo ese material
 * disponible" — uma negação falsa, já que o catálogo TEM fotos, só não
 * dava pra saber de qual serviço. Só ativa quando o cliente realmente
 * mencionou foto/vídeo nesta mensagem (nunca insere isso à toa numa
 * mensagem sem relação, ex: "quanto custa?").
 */
function noMidiaActionResult(text: string, hasAnyMediaInCatalog: boolean): { actionsSummary: string[] } {
  if (hasAnyMediaInCatalog && PHOTO_VIDEO_KEYWORD_RE.test(text)) {
    return {
      actionsSummary: [
        'Cliente perguntou sobre foto/vídeo mas não ficou claro de qual serviço (ou esse serviço específico não tem mídia cadastrada) — o catálogo TEM fotos/vídeos reais de outros serviços; nunca diga que não tem nenhum material disponível, pergunte qual serviço ela quer ver ou diga que só aquele em particular ainda não tem exemplo.',
      ],
    };
  }
  return { actionsSummary: [] };
}

async function runMidiaTool(
  tenantId: string,
  ai: GoogleGenAI,
  text: string,
  phone: string,
  mediaConfig: MediaSendConfig,
  history?: { sender: 'lead' | 'agent'; text?: string }[],
  groqApiKey?: string
): Promise<{ actionsSummary: string[] }> {
  const kb = await getKnowledgeBase(tenantId);
  const productsWithPhoto = (kb?.products || []).filter((p) => p.exampleImageBase64);
  const productsWithVideo = (kb?.products || []).filter((p) => p.exampleVideoId);
  if (!productsWithPhoto.length && !productsWithVideo.length) return { actionsSummary: [] };

  const historyText = buildHistoryText(history);
  const photoList = productsWithPhoto.map((p) => `- ${p.name}`).join('\n');
  const videoList = productsWithVideo.map((p) => `- ${p.name}`).join('\n');

  const prompt = `${productsWithPhoto.length ? `Produtos/serviços com FOTO de exemplo disponível pra enviar de verdade:\n${photoList}\n\n` : ''}${productsWithVideo.length ? `Produtos/serviços com VÍDEO de exemplo disponível pra enviar de verdade (prefira vídeo quando o mesmo produto tiver os dois — é mais persuasivo):\n${videoList}\n\n` : ''}${historyText ? `Histórico recente da conversa:\n${historyText}\n` : ''}Mensagem do cliente: "${text}"

Só decida enviar_foto_exemplo ou enviar_video_exemplo se o cliente pediu explicitamente pra ver foto/vídeo/exemplo/resultado de um desses serviços, ou está claramente decidido sobre um serviço específico dessa lista e isso ajudaria a fechar. Se o cliente não mencionou nada relacionado a um desses serviços, ou o interesse ainda não está claro, decida "nenhuma".`;

  let call: MidiaCall | undefined;

  if (groqApiKey) {
    try {
      call = await decideMidiaActionViaGroq(tenantId, groqApiKey, prompt);
      if (!call) return noMidiaActionResult(text, true);
    } catch (err) {
      console.warn(`⚠️  [Mídia] Groq falhou (tenant=${tenantId}), caindo pro Gemini:`, (err as Error)?.message || err);
      call = undefined;
    }
  }

  if (!call) {
    const response = await withGeminiRetryAndUsage(
      tenantId,
      'foto',
      () =>
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

    const geminiCall = response.functionCalls?.[0];
    if (!geminiCall || (geminiCall.name !== 'enviar_foto_exemplo' && geminiCall.name !== 'enviar_video_exemplo')) return noMidiaActionResult(text, true);
    call = { name: geminiCall.name, args: { nome_produto: geminiCall.args?.nome_produto as string | undefined } };
  }

  const nomeProduto = call.args.nome_produto || '';
  // Achado real em produção: o Gemini nem sempre devolve o nome EXATO
  // (mesma caixa/espaçamento) do catálogo — comparação estrita (p.name ===
  // nomeProduto) já causou "produto não tem mídia cadastrada" pra um
  // produto que TINHA vídeo cadastrado de verdade, silenciosamente.
  // findProductMatch (knowledgeBaseStore.ts) é a mesma resolução usada nos
  // outros 6 pontos que buscam produto por nome vindo de texto livre da IA
  // (duração, bookable, financeiro, Meta CAPI) — inclusive resolve pelo
  // código de uma VARIANTE dentro de uma família (mídia sempre mora no
  // produto pai, nunca na variante).
  const matchedProduct = findProductMatch(kb, nomeProduto)?.product;

  if (call.name === 'enviar_video_exemplo') {
    const product = matchedProduct?.exampleVideoId ? matchedProduct : undefined;
    if (!product?.exampleVideoId) {
      console.warn(`⚠️  [runMidiaTool] enviar_video_exemplo: "${nomeProduto}" não bateu com nenhum produto com vídeo cadastrado (tenant=${tenantId}). Catálogo com vídeo: [${productsWithVideo.map((p) => p.name).join(', ')}]`);
      // Achado real em produção (Monique, 20/08/2026): cliente pediu foto/vídeo
      // duma CATEGORIA genérica ("Pestañas", "cílios"), não do nome exato de um
      // produto do catálogo — nome_produto vem errado da IA, cai aqui, e sem
      // essa ressalva o especialista lia "esse produto não tem X cadastrado" e
      // generalizava pra "não tenho NENHUM material", mesmo o catálogo tendo
      // vídeo real de outros serviços da mesma categoria (ver mesmo achado no
      // helper noMidiaActionResult acima).
      return { actionsSummary: [`Tentou enviar vídeo de "${nomeProduto}" mas esse nome não bate com nenhum produto do catálogo com vídeo cadastrado — NUNCA diga que não tem material nenhum disponível; pergunte qual serviço específico ela quer ver, ou, se "${nomeProduto}" já é claramente um serviço específico (não uma categoria genérica), diga só que esse em particular ainda não tem vídeo de exemplo. Serviços com vídeo real disponível: ${productsWithVideo.map((p) => p.name).join(', ')}.`] };
    }
    const video = await getKnowledgeBaseVideo(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, tenantId, product.exampleVideoId);
    if (!video) {
      return { actionsSummary: [`Tentou enviar vídeo de "${product.name}" mas o arquivo não foi encontrado no Storage.`] };
    }

    try {
      const mimeType = product.exampleVideoMimeType || video.contentType;
      const filename = product.exampleVideoFileName || `${product.name}.mp4`;

      if (mediaConfig.provider === 'evolution') {
        await sendEvolutionMediaMessage(
          mediaConfig.evolutionInstanceName,
          mediaConfig.evolutionApiUrl,
          mediaConfig.evolutionApiKey,
          phone,
          video.buffer.toString('base64'),
          mimeType,
          filename,
          product.name
        );
      } else {
        const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, video.buffer, mimeType, filename);
        await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType, product.name);
      }

      // Achado real em produção (15/08/2026, Clic Piscinas): o vídeo abria
      // normalmente no WhatsApp real do lead, mas o painel nunca teve
      // preview de vídeo nenhum — só um card estático "Vídeo enviado".
      // Salva o binário sob o MESMO id da mensagem (mesmo mecanismo já
      // usado pra imagem enviada pelo painel, ver mediaImageStore.ts) pra
      // GET /api/media/:messageId conseguir servir de volta.
      const videoMessageId = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveMediaImage(mediaConfig.supabaseUrl, mediaConfig.supabaseKey, videoMessageId, video.buffer.toString('base64'), mimeType);
      await recordOutgoingMessage(tenantId, phone, {
        type: 'file',
        text: `🎥 Vídeo de exemplo: ${product.name}`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      }, 'ai', undefined, undefined, videoMessageId);
      return { actionsSummary: [`Enviou o vídeo de exemplo real de "${product.name}" pro cliente agora.`] };
    } catch (err: any) {
      // Achado real em produção (20/08/2026): esse catch nunca logava nada —
      // uma falha real de envio (upload rejeitado pela Meta, timeout, mídia
      // corrompida) ficava 100% invisível nos logs do servidor, só virava um
      // texto genérico pro modelo escrever pro cliente. Zero "Enviou a foto"
      // e zero "não bateu com nenhum produto" nos logs de 7 dias, mesmo com
      // clientes reais pedindo foto de serviços que TINHAM foto cadastrada,
      // só fazia sentido por uma falha exatamente aqui, nunca logada.
      console.warn(`⚠️  [runMidiaTool] enviar_video_exemplo: falha ao enviar vídeo de "${product.name}" (tenant=${tenantId}, phone=${phone}):`, err?.message || err);
      return { actionsSummary: [`Tentou enviar o vídeo de "${product.name}" mas falhou (${err.message}) — não prometa que o vídeo foi enviado.`] };
    }
  }

  const product = matchedProduct?.exampleImageBase64 ? matchedProduct : undefined;
  if (!product?.exampleImageBase64) {
    console.warn(`⚠️  [runMidiaTool] enviar_foto_exemplo: "${nomeProduto}" não bateu com nenhum produto com foto cadastrada (tenant=${tenantId}). Catálogo com foto: [${productsWithPhoto.map((p) => p.name).join(', ')}]`);
    // Mesmo achado do bloco de vídeo acima — nome_produto pode ser uma
    // categoria genérica ("Pestañas") em vez do nome exato de um produto do
    // catálogo; sem a ressalva o especialista generalizava isso em "não
    // tenho NENHUM material", mesmo com foto real de outros serviços.
    return { actionsSummary: [`Tentou enviar foto de "${nomeProduto}" mas esse nome não bate com nenhum produto do catálogo com foto cadastrada — NUNCA diga que não tem material nenhum disponível; pergunte qual serviço específico ela quer ver, ou, se "${nomeProduto}" já é claramente um serviço específico (não uma categoria genérica), diga só que esse em particular ainda não tem foto de exemplo. Serviços com foto real disponível: ${productsWithPhoto.map((p) => p.name).join(', ')}.`] };
  }

  try {
    const mimeType = product.exampleImageMimeType || 'image/jpeg';
    const filename = `${product.name}.jpg`;

    if (mediaConfig.provider === 'evolution') {
      await sendEvolutionMediaMessage(
        mediaConfig.evolutionInstanceName,
        mediaConfig.evolutionApiUrl,
        mediaConfig.evolutionApiKey,
        phone,
        product.exampleImageBase64,
        mimeType,
        filename,
        product.name
      );
    } else {
      const mediaBuffer = Buffer.from(product.exampleImageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const mediaId = await uploadWhatsAppMedia(mediaConfig.phoneNumberId, mediaConfig.accessToken, mediaBuffer, mimeType, filename);
      await sendWhatsAppMediaMessage(mediaConfig.phoneNumberId, mediaConfig.accessToken, phone, mediaId, mimeType, product.name);
    }

    await recordOutgoingMessage(tenantId, phone, {
      type: 'image',
      text: `📷 Foto de exemplo: ${product.name}`,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }, 'ai');
    return { actionsSummary: [`Enviou a foto de exemplo real de "${product.name}" pro cliente agora.`] };
  } catch (err: any) {
    // Mesmo achado do catch de vídeo acima — nunca logava nada, então uma
    // falha real de upload/envio (a foto real da Monique pode passar de
    // 3MB em base64 — perto do limite de mídia da própria Meta) ficava
    // invisível pra sempre, só virava um texto genérico pro cliente.
    console.warn(`⚠️  [runMidiaTool] enviar_foto_exemplo: falha ao enviar foto de "${product.name}" (tenant=${tenantId}, phone=${phone}):`, err?.message || err);
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
  mediaConfig?: MediaSendConfig,
  /** ID da mensagem do WhatsApp que disparou esta resposta — idempotência de criar_pre_reserva (Etapa 2), nunca duplica por reentrega de webhook. */
  messageId?: string,
  /** Título do anúncio "Clique para WhatsApp" que originou a conversa (ver conversationStore.attachAdReferralIfMissing) — usado só na abertura (histórico vazio) pra saudação soar como continuação natural do anúncio, nunca repetido depois. */
  adHeadline?: string,
  /**
   * Orientação de um atendente humano deixada num escalonamento (issue #97)
   * — o cliente ficou sem resposta, o operador não quis assumir a conversa
   * pessoalmente, e essa nota é o que ele escreveu pra IA usar como base ao
   * retomar. Só chega aqui quando o cliente manda uma NOVA mensagem depois
   * da nota (webhooks.ts consome a nota pendente e chama isto) — nunca
   * dispara uma mensagem por conta própria sem o cliente ter escrito algo.
   */
  operatorGuidance?: string,
  /** Router fallback Groq (plano aprovado) — ver classifyAgent. Opcional: sem ela, o router usa só o Gemini como sempre. */
  groqApiKey?: string,
  /**
   * Quantas mensagens do WhatsApp o buffer de rajada (messageBuffer.ts)
   * agrupou em `text` (`texts.join('\n')`) — sinal real de "isto é rajada",
   * em vez de inferir contando linhas de `text` (ambíguo: uma única
   * mensagem pode ter quebra de linha interna legítima). Chamadores que não
   * bufferizam (ex: transcrição de áudio) podem simplesmente omitir.
   */
  messageCount?: number,
  /** Primeiro contato identificado como entrada de anúncio (headline Meta ou ice breaker configurado). A mensagem pode ter sido pré-preenchida pelo anúncio, portanto indica interesse inicial — não pedido confirmado de agenda. */
  isCampaignEntry: boolean = false
): Promise<AutoReplyResult | null> {
  if (!ai || !text.trim()) return null;
  const isBurst = messageCount !== undefined ? messageCount > 1 : undefined;
  const isFirstCampaignContact = isCampaignEntry && (!history || history.length === 0);

  try {
    const routerStart = Date.now();
    const routedAgent = await classifyAgent(tenantId, ai, text, history, phone, groqApiKey, isBurst);
    // A frase pré-preenchida do anúncio pode dizer “quero reservar”, mas não
    // comprova intenção real de agenda. No primeiro toque de uma campanha, a
    // etapa correta é qualificar interesse com baixo atrito; horários só
    // entram depois de uma resposta livre da própria lead.
    const agent = isFirstCampaignContact ? 'triagem' : routedAgent;
    const routerElapsedMs = Date.now() - routerStart;

    let extraContext: string | undefined;
    let forcedHumanConfirmation = false;
    let stopAutoReply = false;
    let confirmedTimes: string[] = [];
    let quickReplyOptions: AutoReplyResult['quickReplyOptions'];
    // Epic 4.5.7 — precisa ser "as ferramentas rodaram de verdade nesta
    // mensagem", não "confirmaram algum horário livre". Achado numa
    // auditoria pós-lançamento: gatear só por confirmedTimes.length deixava
    // a validação inteira desligada bem no caso mais perigoso — cliente pede
    // um horário, verificar_disponibilidade confirma OCUPADO (não gera
    // nenhum confirmedTimesHHmm), e o modelo é livre pra "sugerir uma
    // alternativa" que nunca foi checada de verdade contra a agenda real.
    let agendamentoToolsRan = false;

    // Achado real em produção (Monique, 19/08/2026): esses dois blocos eram
    // um if/else-if mutuamente exclusivos por `agent`. Assim que o roteador
    // classificava a mensagem como "agendamento" (comum no meio de uma
    // conversa já falando de preço/horário), runMidiaTool nunca rodava —
    // mesmo quando a cliente literalmente pediu foto ("Tiene fotos?") e o
    // produto TINHA foto cadastrada. O especialista, sem nenhum resultado de
    // ferramenta, respondia de improviso que não tinha fotos disponíveis.
    // Os dois agora rodam de forma independente sempre que fizerem sentido.
    const contextParts: string[] = [];

    if (!isFirstCampaignContact && agent === 'agendamento' && phone && calendarConfig?.clientId && calendarConfig?.clientSecret) {
      const result = await runAgendamentoTools(tenantId, ai, text, phone, calendarConfig, history, contactName, messageId);
      if (result.actionsSummary.length) {
        contextParts.push(result.actionsSummary.map((s) => `- ${s}`).join('\n'));
      }
      // Bug real de produção: cliente perguntou "posso hoje?" sem citar horário
      // específico -> nenhuma ferramenta rodou (regra "falta informação, não
      // chame ferramenta") -> o especialista compôs a resposta sem NENHUMA
      // noção do horário de funcionamento e ofereceu "hoje" já com o
      // estúdio fechado. O status de expediente precisa chegar aqui sempre
      // que o agente é agendamento, não só quando uma ferramenta roda.
      if (result.businessHoursStatus) {
        contextParts.push(result.businessHoursStatus);
      }
      forcedHumanConfirmation = result.hadError;
      confirmedTimes = result.confirmedTimes;
      agendamentoToolsRan = result.actionsSummary.length > 0;
    }

    if (phone && hasMediaSendConfig(mediaConfig)) {
      const { actionsSummary } = await runMidiaTool(tenantId, ai, text, phone, mediaConfig!, history, groqApiKey);
      if (actionsSummary.length) {
        contextParts.push(actionsSummary.map((s) => `- ${s}`).join('\n'));
      }
    }

    if (contextParts.length) {
      extraContext = contextParts.join('\n');
    }

    // A origem de anúncio só orienta a primeira interação. Mensagens
    // pré-preenchidas são conveniência da Meta, não confirmação de que a
    // pessoa aceita preço, quer agenda ou sequer leu todos os detalhes.
    let adContext: string | undefined;
    if (isFirstCampaignContact) {
      const campaignTheme = adHeadline ? ` com o tema "${adHeadline}"` : '';
      const baseAdContext = `Este é o primeiro contato de uma lead que chegou por um anúncio "Clique para WhatsApp"${campaignTheme}. A mensagem inicial pode ter sido pré-preenchida pelo próprio anúncio: trate-a como SINAL DE INTERESSE, nunca como pedido confirmado de agendamento, preço aceito ou escolha definitiva do serviço. Faça uma abertura curta, contextual e sem pressão. A microconversão deste turno é conseguir uma resposta livre da lead sobre o que ela quer ver primeiro (por exemplo: valor, resultado/como funciona ou disponibilidade). NÃO consulte, ofereça nem cite horários agora; NÃO mande preço, duração e catálogo completos de uma vez; NÃO faça a pergunta genérica “qual serviço você busca?” se o tema da campanha já permite uma referência mais útil. Se a lead tiver digitado uma pergunta concreta além do texto padrão, responda essa pergunta antes de convidá-la a escolher o próximo assunto. Nunca repita a menção ao anúncio nos turnos seguintes.`;
      const kb = await getKnowledgeBase(tenantId);
      const matchedService = adHeadline ? findServiceNamedInHeadline(adHeadline, kb?.products) : undefined;
      adContext = matchedService
        ? `${baseAdContext} O tema corresponde ao serviço "${matchedService.name}". Você pode mencioná-lo de forma breve, mas sem pressupor que ela quer fechar: apresente o benefício em uma frase e pergunte o que ela prefere saber primeiro.`
        : baseAdContext;
    }

    const operatorGuidanceContext = operatorGuidance
      ? `Um atendente humano deixou esta orientação pra você usar ao responder (siga-a ao montar a resposta, sem citar que veio de um "atendente" ou de uma "nota" — fale diretamente com o cliente): "${operatorGuidance}"`
      : undefined;
    const combinedExtraContext = [extraContext, operatorGuidanceContext].filter(Boolean).join('\n');
    // Única fonte de horário de funcionamento que o agente consulta, pra
    // QUALQUER tipo de mensagem — não só agendamento (ver
    // formatBusinessHoursForPrompt em tenantProfileStore.ts). Antes disso um
    // texto solto duplicado na base de conhecimento era o único jeito de uma
    // pergunta casual de FAQ sobre horário ser respondida, arriscando
    // divergir do valor real sem aviso nenhum.
    const businessHoursForPrompt = formatBusinessHoursForPrompt(await getTenantBusinessHours(tenantId).catch(() => null));
    const fullKnowledgeBaseContext = [knowledgeBaseContext, businessHoursForPrompt].filter(Boolean).join('\n\n');
    const specialist = await generateSpecialistReply(tenantId, ai, agent, text, segment, contactName, fullKnowledgeBaseContext, history, combinedExtraContext || undefined, adContext, isBurst);
    if (!specialist) {
      console.warn('⚠️  Gemini Auto-Reply: resposta vazia, nada enviado.');
      return null;
    }

    // Epic 4.5.7 — anti-alucinação: nenhum horário citado na resposta pode
    // ser diferente dos horários realmente confirmados — seja por uma
    // ferramenta de agenda que rodou NESTA mensagem, seja por um
    // agendamento ATIVO já existente pra este contato (`confirmedTimes` já
    // inclui o horário dele mesmo quando nenhuma ferramenta roda de novo,
    // ver runAgendamentoTools). Comparar sempre contra confirmedTimes (nunca
    // só "alguma ferramenta rodou?") é o que distingue as duas situações
    // reais encontradas em produção:
    // 1) o modelo inventa um horário sem NENHUM agendamento real por trás
    //    (ex: "já deixei pré-agendado seu horário pra segunda, às 10:00"
    //    sem criar_agendamento/criar_pre_reserva terem rodado) — precisa
    //    escalar pra humano, é uma alucinação de verdade.
    // 2) o cliente só manda "ok"/"obrigada"/pede a localização de novo,
    //    sem precisar de nenhuma ferramenta nova, e o modelo simplesmente
    //    RECONFIRMA o horário já agendado de verdade (ex: 14:00, com evento
    //    real no Google Calendar) — achado real em produção: a versão
    //    anterior tratava esse caso 2 exatamente igual ao caso 1 só porque
    //    "nenhuma ferramenta rodou nesta mensagem", apagando respostas
    //    corretas (inclusive a localização do estúdio) e substituindo por
    //    uma frase genérica em português — mesmo a conversa inteira sendo
    //    em espanhol — toda vez que o cliente só confirmava/agradecia algo
    //    sobre um agendamento já real.
    let bubbles = specialist.bubbles;
    if (agent === 'agendamento') {
      const citedTimes = extractCitedTimes(bubbles.join(' '));
      const invalidTimes = citedTimes.filter((t) => !confirmedTimes.includes(t));
      if (invalidTimes.length) {
        console.warn(`⚠️  [Anti-alucinação] tenant=${tenantId} modelo citou horário(s) não confirmado(s) (${invalidTimes.join(', ')}) — corrigindo resposta (ferramenta rodou nesta mensagem: ${agendamentoToolsRan}). Confirmados: ${confirmedTimes.join(', ') || '(nenhum)'}.`);
        // Achado real em produção (19/08/2026, Mabel): consultar_disponibilidade_semana
        // devolve o mesmo horário HH:mm repetido uma vez por dia livre (até
        // 7x) — sem dedup nem corte aqui, esse fallback determinístico
        // mandava um balão só com dezenas de horários repetidos separados
        // por " o " (chegou a 988 caracteres numa conversa real). Dedup +
        // corte a poucas opções antes de montar a frase — o cliente nunca
        // precisa ver mais que um punhado de horários pra escolher.
        // Achado real em produção (20/08/2026): mesmo cortado a 6 horários,
        // uma lista crua de HH:mm separados por vírgula soa robótica e
        // pesada pro cliente ler no WhatsApp. Desde que
        // consultar_disponibilidade_semana passou a devolver só os horários
        // PADRÃO do estúdio (08:30/13:30/16:30/18:30, ver executeCalendarTool
        // acima), confirmedTimes já vem restrito a essa lista — dedupe +
        // corte a 3 aqui só garante que 18:30 (o "extra", só pra quando o
        // cliente pede depois das 16:30) nunca aparece no fallback padrão,
        // mesmo que esteja livre.
        const MAX_TIMES_IN_FALLBACK = 3;
        const uniqueConfirmedTimes = [...new Set(confirmedTimes)].sort();
        const timesToShow = uniqueConfirmedTimes.slice(0, MAX_TIMES_IN_FALLBACK);
        const hasMore = uniqueConfirmedTimes.length > timesToShow.length;
        bubbles = timesToShow.length
          ? [`Dejame confirmarte bien: tengo libre a las ${timesToShow.join(', ')}${hasMore ? ' (o te paso más opciones si preferís otro horario)' : ''}. ¿Cuál te queda mejor?`]
          : ['Dejame confirmar bien ese horario en la agenda antes de asegurarte algo — en un instante te aviso.'];
        // Botões de resposta rápida reais (pedido real, 20/08/2026) — só faz
        // sentido quando sobrou pelo menos 1 horário pra oferecer (o caso
        // "nenhum horário confirmado" acima não tem o que virar botão). Cabe
        // certinho no limite de 3 botões da própria Meta, já que
        // MAX_TIMES_IN_FALLBACK também é 3. Título do botão = o horário
        // "HH:mm" puro — quando o cliente toca, webhookParsers.ts já trata a
        // resposta como se ele tivesse digitado esse texto, então o resto do
        // fluxo de agendamento nem precisa saber que veio de um toque.
        if (timesToShow.length) {
          quickReplyOptions = {
            bodyText: '¡Tengo estos horarios libres! ¿Cuál te queda mejor?',
            buttons: timesToShow.map((t) => ({ id: `horario_${t}`, title: t })),
          };
        }
        // Só escala pra humano quando é o caso 1 real (nenhuma ferramenta
        // rodou nesta mensagem pra sustentar o horário citado) — o caso 2
        // (reconfirmando um agendamento já existente) não precisa de
        // atenção humana, só da resposta corrigida acima. Achado real em
        // produção: mesmo escalando, nada impedia a resposta automática de
        // tentar de novo na PRÓXIMA mensagem do cliente e cair na mesma
        // alucinação outra vez — o mesmo fallback saiu idêntico 6x na mesma
        // conversa. Alucinação de verdade (sem nenhuma ferramenta rodando
        // pra sustentar o horário) marca stopAutoReply — quem chama decide
        // como parar (ver webhooks.ts, bloqueia a IA só pra esse número até
        // um humano reativar), em vez de deixar o agente tentar de novo
        // sozinho e repetir o mesmo erro.
        if (!agendamentoToolsRan) {
          forcedHumanConfirmation = true;
          stopAutoReply = true;
        }
      }
    }

    // Gate determinístico de confirmação prematura de agendamento (16/08/2026,
    // "Opção A", ver containsPrematureBookingConfirmation acima) — corrige
    // ANTES de sair sempre que o pagamento ainda não foi aprovado (aguardando
    // comprovante, pendente de verificação, ou rejeitado), mesmo que o
    // modelo (ou o histórico da conversa) tenha escrito uma frase de
    // confirmação. Desde a issue #289, 'awaiting_payment' significa que nem
    // existe evento real na agenda ainda — só uma reserva temporária.
    //
    // Achado real em produção (19/08/2026, Mabel/tenant Monique): criar_agendamento
    // falhou/não rodou nesta mensagem (dados insuficientes ou erro real —
    // mesmo escalonamento "Cliente tentando fechar agendamento" já disparava
    // pro operador via needsHumanConfirmation), então NENHUMA linha em
    // `appointments` chegou a existir — o gate acima nunca disparava porque
    // exigia um currentAppointment já criado. O modelo mesmo assim escreveu
    // "reservado"/"nos queda bien" como se tivesse fechado. Consequência
    // grave: quando o comprovante chegou de verdade minutos depois, o
    // handler de imagem (webhooks.ts) também exige um appointment existente
    // pra logar a escalação de "possível comprovante" — sem ele, o operador
    // NUNCA foi avisado do comprovante, e só descobriu fazendo o
    // agendamento manual depois. Sem currentAppointment nenhum, não existe
    // cenário legítimo de "confirmado"/"reservado" ser verdade — corrige
    // sempre, não só quando o pagamento está pendente.
    if (agent === 'agendamento' && phone) {
      const currentAppointment = await getAppointmentForPhone(tenantId, phone).catch(() => undefined);
      const paymentUnresolved = currentAppointment && (
        currentAppointment.paymentStatus === 'awaiting_payment'
        || currentAppointment.paymentStatus === 'pending_verification'
        || currentAppointment.paymentStatus === 'rejected'
      );
      if (!currentAppointment && containsPrematureBookingConfirmation(bubbles.join(' '))) {
        console.warn(`⚠️  [Gate de agendamento inexistente] tenant=${tenantId} modelo confirmou/reservou o turno em texto mas nenhum agendamento real existe pra este contato — corrigindo resposta.`);
        bubbles = ['Dejame confirmar bien la disponibilidad antes de asegurarte el turno — en un instante te aviso si quedó todo listo.'];
        quickReplyOptions = undefined; // bubbles mudou — os botões do fallback anterior (se houver) não fazem mais sentido pra este texto novo
      } else if (paymentUnresolved && containsPrematureBookingConfirmation(bubbles.join(' '))) {
        console.warn(`⚠️  [Gate de pagamento pendente] tenant=${tenantId} modelo confirmou o turno em texto mas o pagamento ainda está "${currentAppointment.paymentStatus}" — corrigindo resposta.`);
        bubbles = [currentAppointment.paymentStatus === 'awaiting_payment'
          ? 'Ese horario queda reservado para vos hasta que llegue tu comprobante y sea aprobado — todavía no está confirmado, así que enviálo cuanto antes para no perderlo.'
          : 'Recibí tu comprobante, gracias — todavía está pendiente de revisión por parte del estudio. Apenas esté aprobado, te confirmo el turno.'];
        quickReplyOptions = undefined;
      }
    }

    // Gate determinístico de reembolso/desconto (15/08/2026, ver
    // containsUnauthorizedConcessionPromise acima) — needsHumanConfirmation
    // forçado abaixo só ALERTA o operador em paralelo, nunca impede o texto
    // do modelo de sair pro cliente. Corrige ANTES de sair, mesmo padrão do
    // gate de horário: substitui a promessa não confirmada por uma resposta
    // segura, sem prometer nada que a IA não tem autoridade nem ferramenta
    // pra sustentar.
    if (agent === 'reclamacao' && containsUnauthorizedConcessionPromise(bubbles.join(' '))) {
      console.warn(`⚠️  [Gate de reembolso/desconto] tenant=${tenantId} modelo citou reembolso/desconto/cortesia numa reclamação sem autorização — corrigindo resposta.`);
      bubbles = ['Entiendo tu situación — ya avisé a alguien del equipo para que revise tu caso con atención y te confirme los próximos pasos.'];
    }

    // Epic 4.5.8 — toda reclamação escala pra humano, sem exceção. A IA
    // nunca resolve reclamação sozinha (nunca oferece reembolso/retoque por
    // conta própria), então needsHumanConfirmation é sempre true aqui,
    // independente do que o modelo tenha marcado.
    const needsHumanConfirmation = agent === 'reclamacao' ? true : specialist.needsHumanConfirmation || forcedHumanConfirmation;

    return { ...specialist, bubbles, needsHumanConfirmation, stopAutoReply, agent, routerElapsedMs, quickReplyOptions };
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
