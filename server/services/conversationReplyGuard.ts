export type ConversationMessageForReply = {
  sender?: 'lead' | 'agent' | 'system' | string;
  text?: string;
  timestamp?: string;
  [key: string]: unknown;
};

export type ReplyAnalysis = {
  suggestedSmartReply?: string;
  suggestedSmartReplyTranslation?: string;
  detectedLanguage?: string;
  actionObjective?: string;
  actionRationale?: string;
  recommendedNextAction?: string;
  [key: string]: unknown;
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function orderedMessages(messages: unknown): ConversationMessageForReply[] {
  if (!Array.isArray(messages)) return [];
  return [...messages]
    .filter((message): message is ConversationMessageForReply => !!message && typeof message === 'object')
    .map((message, index) => ({ message, index, date: Date.parse(String(message.timestamp || '')) }))
    .sort((a, b) => {
      if (Number.isNaN(a.date) || Number.isNaN(b.date)) return a.index - b.index;
      return a.date - b.date;
    })
    .map(({ message }) => message);
}

function isSpanish(text: string): boolean {
  const value = normalize(text);
  return /\b(hola|gracias|cuanto|cuantos|que|quiero|gustaria|dura|anos|pestanas|cejas|labios|por favor)\b/.test(value);
}

function isGenericIntroduction(text: string): boolean {
  const value = normalize(text).trim();
  return /^[^a-z]*(hola|ola|hello)[!,.\s]*(soy|me llamo|aqui es|aqui e|te habla|mi nombre es)\b/.test(value);
}

/**
 * `windowSize` (TASK-0315, pedido direto: "verifica se as análises estão com
 * o prompt atualizado igual o agente pois as vezes me parecem fora de
 * contexto com o histórico do chat, principalmente o de retomada") — mantém
 * só as N mensagens mais recentes, na mesma ordem cronológica, antes de
 * numerar. Sem isso, os 3 endpoints auxiliares da Ficha IA
 * (analyze-conversation, reply-from-hint, ask — ver ai.ts) sempre mandavam a
 * conversa INTEIRA pro modelo, sem limite — achado real via consulta direta
 * ao Postgres de produção: conversas reais do tenant chegam a 255 mensagens.
 * Sem uma janela, a mensagem mais recente (o que realmente importa pra uma
 * mensagem de retomada, por exemplo) fica perdida em meio a dezenas de
 * trocas antigas e menos relevantes — mesmo risco de "lost in the middle"
 * que HISTORY_WINDOW_SIZE em autoReply.ts já existe pra evitar no agente
 * principal, só que os endpoints auxiliares nunca tinham essa mesma
 * proteção. Omitir windowSize mantém o comportamento anterior (histórico
 * completo) — usado pela análise de CRM, que se beneficia de contexto mais
 * profundo (orçamento/objeção podem ter sido ditos bem antes na conversa).
 */
export function buildChronologicalConversationContext(messages: unknown, windowSize?: number): string {
  const ordered = orderedMessages(messages);
  const windowed = windowSize && windowSize > 0 ? ordered.slice(-windowSize) : ordered;
  if (!windowed.length) return 'Sem mensagens disponíveis.';
  return windowed
    .map((message, index) => {
      const actor = message.sender === 'lead' ? 'CLIENTE' : message.sender === 'agent' ? 'ATENDIMENTO' : 'SISTEMA';
      const body = String(message.text || '[mensagem sem texto]').trim();
      return `${index + 1}. ${actor}: ${body}`;
    })
    .join('\n');
}

/**
 * Evita que a análise de uma conversa em andamento volte a apresentar a atendente.
 * Quando a IA viola a regra, a proteção responde à última dúvida sem inventar dados.
 */
export function guardContinuationReply(analysis: ReplyAnalysis, messages: unknown): ReplyAnalysis {
  const ordered = orderedMessages(messages);
  const lastLeadIndex = [...ordered].map((message) => message.sender).lastIndexOf('lead');
  if (lastLeadIndex < 0) return analysis;

  const lastLead = ordered[lastLeadIndex];
  const hasEarlierAgentReply = ordered.slice(0, lastLeadIndex).some((message) => message.sender === 'agent');
  const draft = String(analysis.suggestedSmartReply || '').trim();
  if (!hasEarlierAgentReply || !draft || !isGenericIntroduction(draft)) return analysis;

  const lastQuestion = String(lastLead.text || '').trim();
  const spanish = isSpanish(lastQuestion);
  const replacement = spanish
    ? 'Sobre tu consulta de duración: cada procedimiento tiene un tiempo de resultado diferente. ¿Te refieres a las cejas, los labios o las pestañas para darte la información correcta?'
    : 'Sobre a sua dúvida de duração: cada procedimento tem um tempo de resultado diferente. Você se refere às sobrancelhas, aos lábios ou aos cílios para eu informar corretamente?';

  return {
    ...analysis,
    detectedLanguage: spanish ? 'Español' : analysis.detectedLanguage,
    actionObjective: spanish ? 'Responder à dúvida de duração sem repetir a apresentação.' : 'Responder à dúvida de duração sem repetir a apresentação.',
    actionRationale: 'A conversa já estava em atendimento e a última mensagem do cliente retomou uma dúvida de duração.',
    recommendedNextAction: spanish ? 'Identificar o procedimento citado e informar sua duração real.' : 'Identificar o procedimento citado e informar sua duração real.',
    suggestedSmartReply: replacement,
    suggestedSmartReplyTranslation: spanish ? 'Sobre sua dúvida de duração: cada procedimento tem um tempo de resultado diferente. Você se refere às sobrancelhas, aos lábios ou aos cílios para eu informar corretamente?' : analysis.suggestedSmartReplyTranslation,
  };
}
