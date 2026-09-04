import type { TrackedAppointment } from './appointmentStore';
import type { Escalation } from './escalationStore';
import type { ContactAgentMemory, ContactAgentMemoryPatch, ContactMemoryOpenLoop } from './contactAgentMemoryStore';
import type { AgentKnowledgeBase } from './knowledgeBaseStore';
import { getAppointmentForPhone } from './appointmentStore';
import { getContactAgentMemory } from './contactAgentMemoryStore';
import { getOpenEscalationForPhone } from './escalationStore';

export const CONTEXT_PACK_VERSION = 'contact-context-v1';

export type ContextAgent = 'triagem' | 'faq' | 'agendamento' | 'reclamacao';

export interface AgentContextPack {
  version: typeof CONTEXT_PACK_VERSION;
  memory: ContactAgentMemory | null;
  liveState: {
    appointment: Pick<TrackedAppointment, 'paymentStatus' | 'heldUntil' | 'eventId'> | null;
    appointmentAvailable: boolean;
    escalation: (Pick<Escalation, 'id' | 'kind' | 'resolved'> & Partial<Pick<Escalation, 'reason' | 'createdAt'>>) | null;
    escalationAvailable: boolean;
  };
  selectedFacts: Record<string, unknown>;
  promptSection: string;
}

export interface LoadAgentContextPackResult {
  contextPack: AgentContextPack;
  issues: Array<'memory' | 'appointment' | 'escalation'>;
}

export interface DeriveContactMemoryInput {
  existingMemory: ContactAgentMemory | null;
  agent: ContextAgent;
  text: string;
  capturedClientName?: string;
  pendingOwnerReview?: string;
  awaitingCustomerChoice?: string;
  needsHumanConfirmation: boolean;
  liveState: AgentContextPack['liveState'];
  /** TASK-0246: catálogo real do tenant, pra `inferServiceInterest` casar o
      texto do lead contra produtos/categorias de verdade em vez de uma
      lista fixa de 3 categorias hardcoded pra estética (achado real numa
      auditoria: `serviceInterest` nunca detectava nada fora de "pestañas/
      cejas/labios", quebrado pra qualquer tenant de outro segmento, ex:
      Clic Piscinas). Opcional — sem catálogo (tenant ainda sem produtos
      cadastrados), cai no fallback antigo (ver `inferServiceInterest`). */
  knowledgeBase?: AgentKnowledgeBase | null;
}

function compactText(value: string | null | undefined, maxLength = 180): string | null {
  if (!value) return null;
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted ? compacted.slice(0, maxLength) : null;
}

function formatPaymentStatus(status: TrackedAppointment['paymentStatus'] | undefined): string | null {
  switch (status) {
    case 'awaiting_payment': return 'aguardando comprovante; não está confirmado';
    case 'pending_verification': return 'comprovante em verificação humana; não está confirmado';
    case 'rejected': return 'comprovante rejeitado; requer orientação humana';
    case 'verified': return 'pagamento verificado; a confirmação final segue o fluxo vigente';
    case 'confirmed': return 'confirmado no registro operacional';
    default: return null;
  }
}

function renderMemory(memory: ContactAgentMemory | null): string[] {
  if (!memory) return ['- Nenhuma memória estruturada disponível ainda para este contato.'];
  const lines: string[] = [];
  if (memory.preferred_language) lines.push(`- Idioma preferido registrado: ${memory.preferred_language}.`);
  if (memory.preferred_name) lines.push(`- Nome preferido registrado: ${memory.preferred_name}.`);
  if (memory.current_intent) lines.push(`- Interesse/intent anterior: ${memory.current_intent}.`);
  if (memory.service_interest) lines.push(`- Serviço de interesse explícito: ${memory.service_interest}.`);
  if (memory.objections.length) lines.push(`- Pontos de atenção já explicitados: ${memory.objections.join('; ')}.`);
  if (memory.open_loops.length) lines.push(`- Pendências de conversa: ${memory.open_loops.map((loop) => `${loop.kind}: ${loop.summary}`).join(' | ')}.`);
  if (memory.next_best_action) lines.push(`- Próximo passo sugerido: ${memory.next_best_action}.`);
  return lines.length ? lines : ['- Nenhum fato operacional estruturado registrado ainda.'];
}

function renderLiveState(liveState: AgentContextPack['liveState']): string[] {
  const lines: string[] = [];
  if (!liveState.appointmentAvailable) {
    lines.push('- Agenda/pagamento: estado vivo indisponível neste turno; não confirme horário ou pagamento sem as ferramentas e gates vigentes.');
  } else if (liveState.appointment) {
    const payment = formatPaymentStatus(liveState.appointment.paymentStatus);
    lines.push(payment
      ? `- Agenda/pagamento (fonte de verdade atual): existe registro ativo; status: ${payment}.`
      : '- Agenda/pagamento (fonte de verdade atual): existe registro ativo; consulte as ferramentas e gates existentes antes de prometer qualquer confirmação.');
  } else {
    lines.push('- Agenda/pagamento (fonte de verdade atual): não há registro ativo encontrado neste momento; não confirme horário nem pagamento sem as ferramentas/gates vigentes.');
  }
  if (!liveState.escalationAvailable) {
    lines.push('- Escalonamentos: estado vivo indisponível neste turno; preserve o tratamento conservador de casos sensíveis.');
  } else if (liveState.escalation) {
    const minutesOpen = liveState.escalation.createdAt
      ? Math.max(0, Math.round((Date.now() - new Date(liveState.escalation.createdAt).getTime()) / 60000))
      : undefined;
    const reasonSnippet = compactText(liveState.escalation.reason, 160);
    lines.push(
      `- Escalonamento humano aberto (${liveState.escalation.kind}${minutesOpen !== undefined ? `, há ${minutesOpen} min` : ''})` +
      `${reasonSnippet ? `, motivo: "${reasonSnippet}"` : ''}: mantenha a decisão sob revisão humana; não prometa resolução, reembolso ou exceção.` +
      ' NÃO reabra nem repita sozinho o mesmo assunto que gerou esta escalação (o mesmo preço/horário/pedido já está em análise humana) — se a cliente insistir nele, reconheça que já está sendo verificado, sem novo prazo ou promessa.'
    );
  }
  return lines;
}

export function buildAgentContextPack(input: {
  memory: ContactAgentMemory | null;
  appointment?: Pick<TrackedAppointment, 'paymentStatus' | 'heldUntil' | 'eventId'> | null;
  appointmentAvailable?: boolean;
  escalation?: (Pick<Escalation, 'id' | 'kind' | 'resolved'> & Partial<Pick<Escalation, 'reason' | 'createdAt'>>) | null;
  escalationAvailable?: boolean;
}): AgentContextPack {
  const liveState = {
    appointment: input.appointment || null,
    appointmentAvailable: input.appointmentAvailable !== false,
    escalation: input.escalation || null,
    escalationAvailable: input.escalationAvailable !== false,
  };
  const selectedFacts = {
    memoryAvailable: !!input.memory,
    preferredLanguage: input.memory?.preferred_language || undefined,
    currentIntent: input.memory?.current_intent || undefined,
    serviceInterest: input.memory?.service_interest || undefined,
    openLoopKinds: input.memory?.open_loops.map((loop) => loop.kind) || [],
    appointmentStateAvailable: liveState.appointmentAvailable,
    hasActiveAppointment: !!liveState.appointment,
    paymentStatus: liveState.appointment?.paymentStatus || undefined,
    escalationStateAvailable: liveState.escalationAvailable,
    hasOpenEscalation: !!liveState.escalation,
    escalationKind: liveState.escalation?.kind || undefined,
  };
  const promptSection = [
    'Contexto operacional do contato (dados compactos e auditáveis):',
    'Use estes dados somente como apoio. Estados de agenda, pagamento e escalonamento abaixo são a fonte de verdade deste turno; nunca os substitua por memória e nunca flexibilize os gates humanos.',
    'Memória estruturada:',
    ...renderMemory(input.memory),
    'Estado vivo:',
    ...renderLiveState(liveState),
  ].join('\n');

  return { version: CONTEXT_PACK_VERSION, memory: input.memory, liveState, selectedFacts, promptSection };
}

/** Carrega cada fonte de forma independente: uma migration atrasada de memória não bloqueia os dados vivos nem a resposta. */
export async function loadAgentContextPack(
  tenantId: string,
  phone: string,
  options: { includeAppointment?: boolean } = {}
): Promise<LoadAgentContextPackResult> {
  const includeAppointment = options.includeAppointment !== false;
  const [memoryResult, appointmentResult, escalationResult] = await Promise.allSettled([
    getContactAgentMemory(tenantId, phone),
    includeAppointment ? getAppointmentForPhone(tenantId, phone) : Promise.resolve(null),
    getOpenEscalationForPhone(tenantId, phone),
  ]);
  const issues: LoadAgentContextPackResult['issues'] = [];
  if (memoryResult.status === 'rejected') issues.push('memory');
  if (includeAppointment && appointmentResult.status === 'rejected') issues.push('appointment');
  if (escalationResult.status === 'rejected') issues.push('escalation');

  return {
    contextPack: buildAgentContextPack({
      memory: memoryResult.status === 'fulfilled' ? memoryResult.value : null,
      appointment: appointmentResult.status === 'fulfilled' ? appointmentResult.value : null,
      appointmentAvailable: includeAppointment && appointmentResult.status === 'fulfilled',
      escalation: escalationResult.status === 'fulfilled' ? escalationResult.value : null,
      escalationAvailable: escalationResult.status === 'fulfilled',
    }),
    issues,
  };
}

function detectExplicitLanguage(text: string): string | undefined {
  const normalized = text.toLocaleLowerCase('pt-BR');
  const portugueseSignals = /(olá|obrigad|voc[eê]|quero|agendar|horário|pagamento|comprovante)/.test(normalized);
  const spanishSignals = /(hola|buenas|gracias|quiero|precio|turno|pestañ|ceja|comprobante|horario)/.test(normalized);
  if (portugueseSignals && !spanishSignals) return 'pt-BR';
  if (spanishSignals && !portugueseSignals) return 'es-PY';
  return undefined;
}

/**
 * TASK-0246 (achado real de auditoria, 03/09/2026): antes disso,
 * `inferServiceInterest` só reconhecia 3 categorias hardcoded de estética
 * (pestañas/cejas/labios) — funcionava só por coincidência pro tenant da
 * Monique e nunca detectava nada pra qualquer outro segmento (ex: Clic
 * Piscinas, tenant real de limpeza de piscina, sem nenhuma menção a
 * "pestaña" nunca vai bater). Agora casa o texto do lead contra o catálogo
 * REAL do tenant — primeiro por categoria (termo mais genérico, mais
 * chance de bater com uma menção casual do cliente), depois por nome
 * comercial/apelido do produto (mais específico).
 */
function inferServiceInterestFromCatalog(normalizedText: string, kb: AgentKnowledgeBase | null | undefined): string | undefined {
  const products = (kb?.products || []).filter((p) => p.active !== false);
  if (!products.length) return undefined;
  const norm = (value: string) => value.trim().toLocaleLowerCase('pt-BR');

  const categories = Array.from(new Set(
    products.map((p) => p.category).filter((c): c is string => !!c && c.trim().length >= 3)
  ));
  for (const category of categories) {
    if (normalizedText.includes(norm(category))) return category;
  }

  for (const product of products) {
    const candidates = [product.name, ...(product.aliases || [])];
    for (const candidate of candidates) {
      const normalizedCandidate = norm(candidate);
      // Exige pelo menos 4 caracteres — evita falso positivo com sigla
      // curta demais casando com qualquer trecho aleatório do texto.
      if (normalizedCandidate.length >= 4 && normalizedText.includes(normalizedCandidate)) return product.name;
    }
  }
  return undefined;
}

function inferServiceInterest(text: string, kb?: AgentKnowledgeBase | null): string | undefined {
  const normalized = text.toLocaleLowerCase('pt-BR');
  const fromCatalog = inferServiceInterestFromCatalog(normalized, kb);
  if (fromCatalog) return fromCatalog;
  // Fallback legado — só entra em ação quando o tenant ainda não tem
  // catálogo cadastrado ou o texto não bateu com nenhum produto/categoria
  // real; mantido como rede de segurança, não mais como caminho principal.
  if (/(pestañ|lash|extens[õo]es)/.test(normalized)) return 'pestañas/extensiones';
  if (/(ceja|sobrancelha|brow|microblading|micropigment)/.test(normalized)) return 'cejas/sobrancelhas';
  if (/(labio|lábio|lip)/.test(normalized)) return 'lábios';
  return undefined;
}

function buildOpenLoops(input: DeriveContactMemoryInput): ContactMemoryOpenLoop[] {
  const loops: ContactMemoryOpenLoop[] = [];
  const paymentStatus = input.liveState.appointment?.paymentStatus;
  if (paymentStatus === 'awaiting_payment') {
    loops.push({ kind: 'payment', summary: 'Aguardando comprovante de pagamento.', status: 'awaiting_customer' });
  } else if (paymentStatus === 'pending_verification' || paymentStatus === 'rejected') {
    loops.push({ kind: 'payment', summary: 'Pagamento requer revisão humana.', status: 'awaiting_human' });
  }
  if (input.liveState.escalation) {
    loops.push({ kind: 'escalation', summary: 'Caso em escalonamento humano.', status: 'awaiting_human' });
  }
  if (input.needsHumanConfirmation && input.agent === 'agendamento') {
    loops.push({ kind: 'agenda', summary: 'Agendamento exige confirmação humana.', status: 'awaiting_human' });
  } else if (input.awaitingCustomerChoice) {
    loops.push({ kind: 'agenda', summary: compactText(input.awaitingCustomerChoice, 200) || 'Aguardando escolha do cliente.', status: 'awaiting_customer' });
  } else if (input.pendingOwnerReview) {
    loops.push({ kind: 'follow_up', summary: compactText(input.pendingOwnerReview, 200) || 'Aguardando avaliação humana.', status: 'awaiting_human' });
  }
  return loops;
}

function deriveNextBestAction(input: DeriveContactMemoryInput): string | undefined {
  if (input.liveState.escalation) return 'Aguardar tratamento humano antes de qualquer confirmação sensível.';
  const paymentStatus = input.liveState.appointment?.paymentStatus;
  if (paymentStatus === 'awaiting_payment') return 'Aguardar comprovante antes de avançar a confirmação.';
  if (paymentStatus === 'pending_verification' || paymentStatus === 'rejected') return 'Aguardar revisão humana do pagamento.';
  if (input.needsHumanConfirmation) return 'Encaminhar para confirmação humana.';
  if (input.awaitingCustomerChoice) return 'Aguardar a escolha solicitada ao cliente.';
  if (input.agent === 'triagem') return 'Entender o serviço de interesse antes de oferecer próximos passos.';
  if (input.agent === 'agendamento') return 'Coletar ou confirmar os dados necessários para consultar disponibilidade.';
  return undefined;
}

/**
 * Atualização P0, sem chamada extra de LLM: usa somente o router, campos já
 * validados da resposta estruturada e estados vivos. Não copia estados de
 * agenda/pagamento/escalonamento para facts_confirmed.
 */
export function deriveContactMemoryPatch(input: DeriveContactMemoryInput): ContactAgentMemoryPatch {
  const serviceInterest = input.existingMemory?.service_interest || inferServiceInterest(input.text, input.knowledgeBase);
  const nextBestAction = deriveNextBestAction(input);
  const conversationSummary = [
    serviceInterest ? `Interesse: ${serviceInterest}.` : null,
    nextBestAction ? `Próximo passo: ${nextBestAction}` : null,
  ].filter(Boolean).join(' ') || undefined;

  return {
    preferredLanguage: input.existingMemory?.preferred_language || detectExplicitLanguage(input.text),
    preferredName: input.capturedClientName || input.existingMemory?.preferred_name || undefined,
    currentIntent: input.agent,
    serviceInterest,
    openLoops: buildOpenLoops(input),
    nextBestAction,
    conversationSummary,
    updatedBy: 'system',
  };
}
