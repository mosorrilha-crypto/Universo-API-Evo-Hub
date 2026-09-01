import crypto from 'crypto';
import { Router } from 'express';
import { parseMetaWebhookPayload, parseEvolutionWebhookPayload, parseInstagramWebhookPayload, friendlyLabelForOtherType, type ParsedIncomingMessage } from '../services/webhookParsers';
import { markProcessedIfNew, unmarkProcessed } from '../services/idempotency';
import { enqueueTranscriptionJob } from '../services/transcriptionQueue';
import { recordIncomingMessage, recordOutgoingMessage, getConversation, markGeoRestricted, attachAdReferralIfMissing, updateConversationState, setConversationNameIfMissing, shouldBlockForAdsOnlyMode, attachCatalogClickIfMatched } from '../services/conversationStore';
import { emitAiReplyStatus } from '../services/conversationEvents';
import { compensateApprovedCalendarExecution, executeApprovedCalendarActions, generateAutoReplyForText, getNowLocalNaive } from '../services/autoReply';
import { localNaiveToUtcIso } from '../services/googleCalendar';
import { markPendingFollowUp, clearPendingFollowUp } from '../services/pendingFollowUpStore';
import { sendBubbles } from '../services/sendBubbles';
import { markAsReadAndShowTyping, isGeoRestrictedError } from '../services/metaSend';
import { showEvolutionTyping } from '../services/evolutionSend';
import { showInstagramTyping } from '../services/instagramSend';
import { isAgentPaused } from '../services/agentStatus';
import { getRuntimeKnowledgeBase, formatKnowledgeBaseForPrompt } from '../services/knowledgeBaseStore';
import { hasFirstContactMessage, sendFirstContactMessage } from '../services/firstContactMessage';
import { getTenantSegment, getTenantBusinessHours } from '../services/tenantProfileStore';
import { runExclusive } from '../services/perPhoneQueue';
import { bufferIncomingText, startBufferRecoverySweeper } from '../services/messageBuffer';
import { logEscalation, isPaymentRelated, looksLikeHarassment, getPendingOperatorGuidance, markOperatorGuidanceConsumed, reviewerEscalationSourceKey } from '../services/escalationStore';
import { downloadMetaMedia, downloadEvolutionMedia } from '../services/mediaDownload';
import { saveMediaImage } from '../services/mediaImageStore';
import { consumePendingEcho } from '../services/outboundEchoTracker';
import { getAppointmentForPhone, markPaymentPendingVerification } from '../services/appointmentStore';
import { analyzePaymentReceiptWithGemini } from '../services/paymentReceiptAnalysis';
import { resolveTenantByPhoneNumberId, resolveTenantByEvolutionInstance, resolveTenantByInstagramAccountId, type ResolvedTenant } from '../services/tenantResolver';
import { redactMessageForLog } from '../services/logRedaction';
import { reviewAutoReplyBeforeSend } from '../services/replySafetyGate';
import { createQualityReview, recordQualityAuditEvent } from '../services/qualityAuditStore';
import { runWithTenantDbContext } from '../services/tenantDbContext';
import { logStructured } from '../services/structuredLog';
import type { GoogleGenAI } from '@google/genai';
import type { CalendarConfig } from '../services/googleCalendar';

// Acompanhamento de funil (pedido real, 15/08/2026 — server/services/pendingFollowUpJob.ts).
const BUSINESS_TIMEZONE = 'America/Asuncion';
const DEFAULT_CLOSE_TIME = '20:00';
const CUSTOMER_REPLY_FOLLOWUP_MS = 2.5 * 60 * 60 * 1000;

/** Fim do dia útil de hoje (horário de fechamento cadastrado pro dia da semana atual, ou 20h se o tenant não configurou) — quando um "aguardando avaliação" vence e escala pro operador. */
async function endOfBusinessDayIso(tenantId: string): Promise<string> {
  const hours = await getTenantBusinessHours(tenantId).catch(() => null);
  const { naive, weekdayNum } = getNowLocalNaive(BUSINESS_TIMEZONE);
  const todayDateKey = naive.slice(0, 10);
  const closeTime = hours?.[String(weekdayNum)]?.close || DEFAULT_CLOSE_TIME;
  return localNaiveToUtcIso(`${todayDateKey}T${closeTime}:00`, BUSINESS_TIMEZONE);
}

interface WebhooksRouterDeps {
  metaWebhookVerifyToken: string;
  /** Segredo do App Meta para validar a assinatura dos POSTs de webhook. */
  metaAppSecret?: string;
  getAi?: () => GoogleGenAI | null;
  /** Router fallback Groq (plano aprovado) — ver classifyAgent em autoReply.ts. Opcional: sem ela, o router usa só o Gemini como sempre. */
  groqApiKey?: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  /** Instância/URL/API key compartilhadas (fallback), mesmo papel de metaAccessToken/metaPhoneNumberId acima pra Porta A (Epic 4.6). */
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
}

export function createWebhooksRouter({ metaWebhookVerifyToken, metaAppSecret, getAi, groqApiKey, metaAccessToken, metaPhoneNumberId, evolutionApiUrl, evolutionApiKey, evolutionInstanceName, supabaseUrl, supabaseKey, googleClientId, googleClientSecret, googleRedirectUri }: WebhooksRouterDeps): Router {
  const calendarConfig: CalendarConfig | undefined = googleRedirectUri
    ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri }
    : undefined;

  const router = Router();

  // Resposta automática pra mensagens de texto (Epic 1.3): gera e envia de
  // volta via Meta Cloud API, sem bloquear a resposta do webhook (fire-and-forget).
  //
  // resolvedTenant vem do Bloco 2.B (server/services/tenantResolver.ts) — já
  // é o tenant/credencial certos pra esse número, resolvidos por
  // phone_number_id antes de chegar aqui.
  const triggerAutoReply = (phone: string, contactName: string | undefined, text: string, messageId: string, historyExclude: number, resolvedTenant: ResolvedTenant, firstMessageId?: string) => {
    const { tenantId, metaAccessToken: token, metaPhoneNumberId: phoneNumberId } = resolvedTenant;
    const isEvolution = resolvedTenant.provider === 'evolution';
    const isInstagram = resolvedTenant.provider === 'instagram';
    const channel = isEvolution
      ? { provider: 'evolution' as const, evolutionInstanceName: resolvedTenant.evolutionInstanceName, evolutionApiUrl: resolvedTenant.evolutionApiUrl, evolutionApiKey: resolvedTenant.evolutionApiKey }
      : isInstagram
      ? { provider: 'instagram' as const, instagramAccountId: resolvedTenant.instagramAccountId, accessToken: resolvedTenant.instagramAccessToken }
      : { provider: 'meta' as const, phoneNumberId, accessToken: token };
    if (!getAi) return;
    // runExclusive garante que, se a mensagem anterior desse número ainda
    // estiver gerando resposta, esta espera a vez — sem isso, uma chamada
    // lenta ao Gemini pode terminar DEPOIS de uma mais rápida disparada por
    // uma mensagem seguinte, respondendo fora de ordem (bug real observado).
    runExclusive(phone, async () => {
      if (await isAgentPaused(tenantId)) return;
      // Exclui as mensagens que acabaram de ser agrupadas pelo buffer (já
      // registradas individualmente antes do flush) — o resto é histórico real.
      const conversation = await getConversation(tenantId, phone);
      // Conversas que o operador iniciou manualmente (por exemplo, com um
      // fornecedor, parceiro ou contato pessoal) não são leads até que o
      // operador as marque explicitamente como lead de anúncio. Sem este
      // gate, qualquer resposta recebida nessa conversa era tratada como se
      // viesse de uma cliente e a IA respondia em nome do estúdio de forma
      // inadequada. O primeiro lead real ainda pode iniciar uma conversa
      // normalmente porque a mensagem atual é registrada antes deste ponto e
      // o histórico anterior permanece vazio.
      const firstHistoricalMessage = conversation?.messages?.[0];
      if (
        firstHistoricalMessage?.sender === 'agent'
        && firstHistoricalMessage.sentBy === 'operator'
        && !conversation?.adGreetingMatchedAt
      ) {
        return;
      }
      // Lead não qualificado/insistente que o operador bloqueou (menu ⋮ do
      // painel) — achado real em produção: um lead claramente fora do
      // público-alvo continuava recebendo resposta automática igual a
      // qualquer outro. Bloqueio é só desse número, não do tenant inteiro
      // (isAgentPaused acima continua valendo pra todos).
      if (conversation?.aiBlockedAt) return;
      // Achado real (pedido do dono do produto, 30/08/2026): quando o
      // operador está respondendo manualmente AO VIVO (contato pessoal que
      // às vezes também é cliente, mesma pessoa numa conversa mista de
      // negócio+papo pessoal), a IA continuava disparando resposta
      // automática pra cada mensagem nova do contato — cruzando com a
      // resposta do operador na mesma janela de segundos. O cliente via as
      // duas "vozes" ao mesmo tempo (uma resposta de "canal oficial de
      // atendimento" logo ao lado de "kkkk vamos sin" do operador),
      // quebrando a ilusão de atendimento humano contínuo — reproduzido
      // tanto num teste quanto observado numa conversa real. Se o operador
      // mandou uma mensagem manual pra este número nos últimos minutos, a
      // IA cede a vez nesta rodada — nenhuma resposta automática enquanto o
      // operador estiver visivelmente engajado. Reaproveita o histórico já
      // carregado, sem tabela nova: sentBy='operator' só existe pra
      // mensagens digitadas de verdade no painel (nunca resposta da IA nem
      // disparo de campanha, ver StoredMessage.sentBy).
      // TASK-0181 (parte 2) — achado real do dono do produto (01/09/2026):
      // numa troca rápida em que o operador responde manualmente várias
      // vezes seguidas, cada resposta dele RENOVA os 5min acima — a IA nunca
      // recupera a vez sozinha, e não havia nenhum jeito de liberar isso na
      // hora (só esperar o contato ficar quieto por 5min inteiros). Se o
      // operador pediu explicitamente "devolver a IA agora" (menu ⋮ da
      // conversa) DEPOIS da própria última mensagem manual dele, a pausa é
      // ignorada nesta rodada — uma nova mensagem manual dele depois disso
      // volta a pausar normalmente (o release não desativa o gate pra sempre).
      const OPERATOR_ACTIVE_PAUSE_MS = 5 * 60 * 1000;
      const lastOperatorMessage = [...(conversation?.messages || [])]
        .reverse()
        .find((m) => m.sender === 'agent' && m.sentBy === 'operator');
      const releasedAfterLastOperatorMessage = conversation?.operatorAiReleaseAt
        && (!lastOperatorMessage || new Date(conversation.operatorAiReleaseAt).getTime() >= new Date(lastOperatorMessage.timestamp).getTime());
      if (
        lastOperatorMessage
        && Date.now() - new Date(lastOperatorMessage.timestamp).getTime() < OPERATOR_ACTIVE_PAUSE_MS
        && !releasedAfterLastOperatorMessage
      ) {
        return;
      }
      // Modo "somente anúncios" (pedido real, 14/08/2026): quando o
      // proprietário conecta um número pessoal além do número dedicado do
      // agente (pra não perder mensagem enquanto valida confiança no
      // agente sozinho), essa chave restringe a resposta automática a
      // contatos identificados como vindos de anúncio (ctwa_clid real OU
      // texto batendo com um gatilho configurado, ver
      // shouldBlockForAdsOnlyMode) — nunca contatos pessoais. Mensagem já
      // foi gravada acima (recordIncomingMessage, antes de chegar aqui) —
      // só a resposta automática fica em silêncio, nunca perde o dado.
      //
      // attachCatalogClickIfMatched roda sempre (mesmo fora do modo
      // somente-anúncios) — liga a conversa a um clique real do catálogo
      // quando reconhece o código de emojis na mensagem, independente do
      // gate de ads_only abaixo (ver comentário na própria função).
      await attachCatalogClickIfMatched(tenantId, phone, text);
      if (await shouldBlockForAdsOnlyMode(tenantId, phone, text)) return;
      const runtimeKnowledgeBase = await getRuntimeKnowledgeBase(tenantId);
      const kb = runtimeKnowledgeBase.knowledgeBase;
      logStructured({
        tenantId,
        area: 'knowledgeBase',
        op: 'loadWebhookRuntimeSource',
        outcome: runtimeKnowledgeBase.source === 'unavailable' ? 'error' : 'success',
        detail: runtimeKnowledgeBase.fallbackReason
          ? `source=${runtimeKnowledgeBase.source};reason=${runtimeKnowledgeBase.fallbackReason}`
          : `source=${runtimeKnowledgeBase.source}`,
      });
      const kbContext = formatKnowledgeBaseForPrompt(kb);
      const segment = await getTenantSegment(tenantId);
      // Achado real em produção (Gladys, tenant Monique, 30/08/2026): cortar
      // por CONTAGEM (`slice(0, -historyExclude)`) supõe que nada mais foi
      // gravado desde que este lote de mensagens picotadas foi bufferizado.
      // runExclusive (perPhoneQueue.ts) serializa os ciclos por telefone,
      // mas um ciclo pode ficar PRESO na fila enquanto o cliente manda MAIS
      // mensagens — já gravadas na hora (recordIncomingMessage roda ANTES
      // de qualquer buffer/fila, ver linha ~488), independente da fila.
      // Quando isso acontece, o corte por contagem pega o lote errado:
      // inclui a própria mensagem deste ciclo (duplicada com `text`, que já
      // recebe o mesmo conteúdo) e perde mensagens novas reais. Corta por
      // IDENTIDADE (tudo antes do ID da primeira mensagem deste lote) — que
      // permanece correto mesmo com mensagens novas chegando enquanto o
      // ciclo espera a vez. Cai pro corte antigo por contagem só quando
      // firstMessageId não foi informado ou não é encontrado no histórico
      // (ex.: recuperação de um buffer persistido de antes desta correção).
      const allMessages = conversation?.messages;
      const cutoffIndex = firstMessageId && allMessages ? allMessages.findIndex((m) => m.id === firstMessageId) : -1;
      const history = !allMessages ? undefined : cutoffIndex !== -1 ? allMessages.slice(0, cutoffIndex) : allMessages.slice(0, -historyExclude);
      // Sinaliza pro painel (SSE) que a IA começou a processar a última
      // mensagem — ver emitAiReplyStatus em conversationEvents.ts. Emitido só
      // depois de todos os gates de silêncio acima (agente pausado, lead
      // bloqueado, modo só-anúncios): a partir daqui alguma saída SEMPRE
      // acontece (mensagem enviada ou escalonamento), então todo caminho do
      // try/catch abaixo precisa terminar com 'sent' ou 'failed'.
      emitAiReplyStatus(tenantId, phone, 'generating');
      try {
        // Ativa "digitando..." já durante a chamada ao Gemini (a espera mais
        // longa), não só na hora de enviar as bolhas.
        if (isEvolution) {
          await showEvolutionTyping(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey);
        } else if (isInstagram) {
          await showInstagramTyping(resolvedTenant.instagramAccountId, resolvedTenant.instagramAccessToken, phone);
        } else {
          await markAsReadAndShowTyping(phoneNumberId, token, messageId);
        }
        // Ferramenta de envio de foto/vídeo (Epic 4.5.2) — suporta Meta e
        // Evolution. Instagram (Fase 1) ainda não — mediaConfig sem
        // phoneNumberId/accessToken pro provider 'meta' faz hasMediaSendConfig
        // (autoReply.ts) devolver false, desligando a ferramenta de mídia pra
        // esse canal até a Fase 2, sem precisar de um branch dedicado aqui.
        // supabaseUrl/supabaseKey só são usados pra buscar o binário do vídeo
        // de exemplo no Storage na hora de enviar (a foto já vem inline na
        // Base de Conhecimento, não precisa disso).
        const mediaConfig = isEvolution
          ? { provider: 'evolution' as const, evolutionInstanceName: resolvedTenant.evolutionInstanceName, evolutionApiUrl: resolvedTenant.evolutionApiUrl, evolutionApiKey: resolvedTenant.evolutionApiKey, supabaseUrl, supabaseKey }
          : isInstagram
          ? { provider: 'instagram' as const, supabaseUrl, supabaseKey }
          : { provider: 'meta' as const, phoneNumberId, accessToken: token, supabaseUrl, supabaseKey };

        // Pedido real (Clic Piscinas, 14/08/2026): em vez da pergunta de
        // triagem padrão da IA logo de cara, mandar primeiro um bloco fixo
        // (texto/imagem/vídeo, definido na Base de Conhecimento) na 1ª
        // mensagem de uma conversa NOVA — a negociação com a IA só começa a
        // partir da PRÓXIMA mensagem do cliente. `history` vazio é o único
        // sinal estrutural de "1ª mensagem de verdade" (a mensagem que
        // acabou de chegar já foi excluída dela, ver historyExclude no
        // início da função). Tenant sem nada configurado em
        // firstContactMessage mantém o comportamento de sempre.
        if (history?.length === 0 && hasFirstContactMessage(kb)) {
          await sendFirstContactMessage(tenantId, phone, kb!, mediaConfig);
          emitAiReplyStatus(tenantId, phone, 'template_sent');
          return;
        }

        // Issue #97 — orientação que um operador deixou num escalonamento,
        // ainda não usada numa resposta real (ex: foi deixada fora da
        // janela de 24h, esperando o cliente escrever de novo pra reabrir a
        // janela — ver operatorFollowUpService.ts). Esta é a mensagem que
        // reabre.
        const pendingGuidance = await getPendingOperatorGuidance(tenantId, phone);
        const isCampaignEntry = Boolean(conversation?.adHeadline || conversation?.adGreetingMatchedAt);
        const result = await generateAutoReplyForText(tenantId, getAi!(), text, contactName, kbContext, history, phone, calendarConfig, segment, mediaConfig, messageId, conversation?.adHeadline, pendingGuidance?.operatorReply, groqApiKey, historyExclude, isCampaignEntry);
        if (!result) {
          // Achado real em produção (issue #82, item 4; revisado depois de
          // uma auditoria de conversas reais): mesmo com retry
          // (autoReply.ts), o Gemini pode ficar indisponível por mais tempo.
          // Chegou a mandar uma mensagem de espera genérica ("tivemos uma
          // instabilidade...") — mas isso soa como bug pro cliente real, sem
          // agregar nada que o operador não vá dizer melhor ao assumir a
          // conversa. Escala silenciosamente: o operador vê no painel e
          // conduz a próxima resposta do zero, sem a IA ter dito nada antes.
          await logEscalation(tenantId, phone, contactName, 'IA não conseguiu gerar resposta automática (falhou mesmo com retry)', text);
          emitAiReplyStatus(tenantId, phone, 'escalated');
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
          return;
        }
        emitAiReplyStatus(tenantId, phone, 'drafted');

        // Política de reclamações: a IA apenas identifica e encaminha. Não há
        // texto automático de "resolução" nem continuidade até o envio, pois
        // uma resposta imprecisa pode agravar o caso e comprometer a apuração
        // humana. A chave da mensagem torna a reentrega do webhook idempotente.
        if (result.agent === 'reclamacao') {
          await logEscalation(
            tenantId,
            phone,
            contactName,
            'Cliente com reclamação — atendimento humano obrigatório; nenhuma resposta automática foi enviada',
            text,
            'general',
            {
              sourceKey: `complaint:${messageId}`,
              priority: 'high',
              dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          );
          console.warn(`⚠️ [Reclamação] tenant=${tenantId} caso ${messageId} escalado para humano sem resposta automática.`);
          emitAiReplyStatus(tenantId, phone, 'escalated');
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
          return;
        }

        const safety = await reviewAutoReplyBeforeSend({
          customerMessage: text,
          draftBubbles: result.bubbles,
          history,
          knowledgeContext: kbContext,
          isBookingFlow: result.agent === 'agendamento',
          needsHumanConfirmation: result.needsHumanConfirmation,
          plannedCalendarActions: result.deferredCalendarActions?.map((action) => action.summary),
          contactName,
        }, { ai: getAi!(), groqApiKey });
        if (!safety.approved) {
          const blockedDraft = result.bubbles.join(' / ').slice(0, 900);
          await logEscalation(
            tenantId,
            phone,
            contactName,
            `Revisor pré-envio bloqueou a resposta automática (${safety.source}, risco ${safety.severity}): ${safety.reason} Rascunho bloqueado: ${blockedDraft}`,
            text,
            'general',
            { sourceKey: reviewerEscalationSourceKey(phone), priority: 'high', blockedDraft }
          );
          console.warn(`🛡️ [Revisor pré-envio] tenant=${tenantId} bloqueou resposta para ${phone}: ${safety.reason}`);
          emitAiReplyStatus(tenantId, phone, 'safety_blocked');
          emitAiReplyStatus(tenantId, phone, 'escalated');
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
          return;
        }
        const calendarExecution = await executeApprovedCalendarActions(
          tenantId,
          phone,
          calendarConfig,
          result.deferredCalendarActions,
          contactName,
          messageId,
        );
        if (calendarExecution.hadError) {
          const reason = calendarExecution.summaries.join(' ');
          await logEscalation(tenantId, phone, contactName, `Ação de agenda aprovada pelo revisor, mas não foi concluída antes do envio: ${reason}`, text);
          console.warn(`⚠️ [Agenda pós-revisão] tenant=${tenantId} nenhuma resposta foi enviada porque a ação aprovada falhou: ${reason}`);
          emitAiReplyStatus(tenantId, phone, 'delivery_failed');
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
          return;
        }
        if (result.agent === 'agendamento' && result.needsHumanConfirmation) {
          await logEscalation(tenantId, phone, contactName, 'Cliente tentando fechar agendamento — precisa de confirmação/atenção humana (dados insuficientes, agenda não conectada, ou falha ao agir na agenda real)', text);
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
        }
        try {
          await sendBubbles(channel, phone, result.bubbles, async (bubbleText) => {
            await recordOutgoingMessage(tenantId, phone, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
            console.log(`🤖 [Resposta Automática] tenant=${tenantId} Enviado pra ${phone}: ${redactMessageForLog(bubbleText)} (agente: ${result.agent})`);
          }, messageId, result.phase, result.routerElapsedMs, result.quickReplyOptions);
        } catch (sendError: any) {
          let compensation = 'Não foi possível iniciar a compensação automática.';
          try {
            compensation = await compensateApprovedCalendarExecution(tenantId, phone, calendarExecution);
          } catch (compensationError: any) {
            compensation = `A compensação automática falhou: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`;
          }
          await logEscalation(tenantId, phone, contactName, `Falha ao enviar resposta após ação de agenda aprovada: ${sendError instanceof Error ? sendError.message : String(sendError)}. ${compensation}`, text);
          console.warn(`⚠️ [Agenda pós-envio] tenant=${tenantId} ${compensation}`);
          emitAiReplyStatus(tenantId, phone, 'delivery_failed');
          emitAiReplyStatus(tenantId, phone, 'awaiting_human');
          return;
        }
        if (pendingGuidance) {
          await markOperatorGuidanceConsumed(tenantId, pendingGuidance.id);
          console.log(`🤝 [Retomada guiada] tenant=${tenantId} usou a orientação do operador pra responder ${phone} (fora da janela original, cliente reabriu agora).`);
        }
        // Achado real em produção: sem isso, uma alucinação de agenda sem
        // nenhuma ferramenta pra sustentar o horário citado (autoReply.ts,
        // stopAutoReply) mandava o MESMO fallback genérico de novo a cada
        // nova mensagem do cliente, em vez de mandar uma vez, escalar, e
        // esperar um humano — chegou a se repetir 6x idêntico na mesma
        // conversa. Reaproveita o mesmo bloqueio manual de "lead não
        // qualificado" (menu ⋮ do painel) — mecanicamente é o mesmo efeito
        // (para a resposta automática só pra este número, resto do tenant
        // continua normal), só a origem do bloqueio que agora também pode
        // ser automática.
        if (result.stopAutoReply) {
          await updateConversationState(tenantId, phone, { aiBlocked: true });
          console.warn(`🛑 [Resposta Automática] tenant=${tenantId} IA bloqueada automaticamente pra ${phone} depois de uma alucinação de agenda sem ferramenta pra sustentar — aguardando atendimento humano.`);
        }
        // A cliente disse o próprio nome na conversa (não veio do perfil do
        // WhatsApp) — grava agora pra virar contactName em todo turno
        // seguinte, sem depender da janela de histórico recente (ver
        // conversationStore.setConversationNameIfMissing).
        if (result.capturedClientName) {
          await setConversationNameIfMissing(tenantId, phone, result.capturedClientName);
        }
        // Acompanhamento de funil (pedido real, 15/08/2026 — auditoria de
        // conversas reais mostrou lead esfriando sem ninguém perceber, ver
        // server/services/pendingFollowUpJob.ts). "owner_review" vence no
        // fim do dia útil (horário de fechamento cadastrado, ou 20h se o
        // tenant não configurou); "customer_reply" vence em ~2h30 — nenhum
        // dos dois reabre contato sozinho, só escala pro operador via
        // Escalonamentos se ninguém resolver antes.
        if (result.pendingOwnerReview) {
          await markPendingFollowUp(tenantId, phone, contactName, 'owner_review', result.pendingOwnerReview, await endOfBusinessDayIso(tenantId));
        }
        if (result.awaitingCustomerChoice) {
          await markPendingFollowUp(tenantId, phone, contactName, 'customer_reply', result.awaitingCustomerChoice, new Date(Date.now() + CUSTOMER_REPLY_FOLLOWUP_MS).toISOString());
        }
        emitAiReplyStatus(tenantId, phone, 'sent');
      } catch (err: any) {
        emitAiReplyStatus(tenantId, phone, 'delivery_failed');
        if (isGeoRestrictedError(err)) {
          await markGeoRestricted(tenantId, phone, err.message);
          await logEscalation(tenantId, phone, contactName, 'Envio bloqueado por restrição geográfica — precisa de atendimento manual', text);
        } else {
          await logEscalation(tenantId, phone, contactName, `Falha ao responder automaticamente: ${err.message}`, text);
        }
        console.warn('❌ [Resposta Automática] Falhou:', err.message);
      }
    });
  };

  // Agrupa mensagens de texto picotadas (2-3 seguidas do mesmo número) antes
  // de disparar a resposta — espera ~6s de silêncio, evitando responder cada
  // fragmento separadamente (denunciaria automação na hora).
  const handleIncomingText = (phone: string, contactName: string | undefined, text: string, messageId: string, resolvedTenant: ResolvedTenant) => {
    bufferIncomingText(phone, contactName, text, messageId, resolvedTenant, (combinedText, bufferedContactName, lastMessageId, messageCount, bufferedTenant, firstMessageId) =>
      runWithTenantDbContext(
        { tenantId: bufferedTenant.tenantId, source: 'webhook' },
        () => triggerAutoReply(phone, bufferedContactName, combinedText, lastMessageId, messageCount, bufferedTenant, firstMessageId)
      )
    );
  };

  // Recupera buffers de rajada presos por um restart de deploy no meio da
  // janela de 6s de silêncio — sem isso, a mensagem ficava perdida pra
  // sempre (achado real, 15/08/2026). Uma vez só no boot do router, o
  // próprio sweeper se reagenda periodicamente por dentro.
  startBufferRecoverySweeper((phone) => (combinedText, bufferedContactName, lastMessageId, messageCount, bufferedTenant, firstMessageId) =>
    runWithTenantDbContext(
      { tenantId: bufferedTenant.tenantId, source: 'job' },
      () => triggerAutoReply(phone, bufferedContactName, combinedText, lastMessageId, messageCount, bufferedTenant, firstMessageId)
    )
  );

  // Extrai as mensagens em um formato comum, resolve de qual tenant é cada
  // uma (Bloco 2.B — por phone_number_id, com fallback pro tenant legado +
  // credencial compartilhada se o número não estiver cadastrado ainda),
  // enfileira áudio pra transcrição (idempotente por message_id) e ignora o
  // resto (texto/imagem por ora — ver Epic 1.3 pra resposta automática).
  // Compartilhado entre os handlers de Meta/Evolution direto e o handler
  // dedicado do Evo Hub.
  const enqueueAudioMessages = async (parsedMessages: ParsedIncomingMessage[]) => {
    let enqueued = 0;
    const nowLabel = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    for (const msg of parsedMessages) {
      if (!(await markProcessedIfNew(msg.messageId))) {
        console.log(`↩️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} já processada, ignorando reentrega.`);
        continue;
      }

      // Tudo daqui pra baixo precisa de try/catch: markProcessedIfNew já
      // marcou essa mensagem como "vista" — se algo falhar sem desfazer
      // isso, a mensagem do lead some pra sempre (a reentrega da Meta, que
      // existe exatamente pra cobrir falha transitória, cai no `continue`
      // acima na próxima tentativa e nunca é gravada). Achado numa auditoria
      // pós-lançamento; corrigido pra sempre desmarcar em caso de erro real,
      // permitindo a reentrega tentar de novo.
      try {
        // Epic 4.6 — mensagem da Evolution API (Porta A) resolve o tenant
        // pela instância, não pelo phone_number_id (conceito que só existe
        // na Meta Cloud API/Porta B). Instagram DM (Fase 1, 15/08/2026) —
        // terceiro canal, resolve pela conta Instagram que recebeu a
        // mensagem, sem fallback nenhum (ver resolveTenantByInstagramAccountId).
        const resolvedTenant = msg.provider === 'evolution'
          ? await resolveTenantByEvolutionInstance(msg.instanceName, { evolutionApiUrl, evolutionApiKey, evolutionInstanceName })
          : msg.provider === 'instagram'
          ? await resolveTenantByInstagramAccountId(msg.instagramAccountId)
          : await resolveTenantByPhoneNumberId(msg.phoneNumberId, { metaAccessToken, metaPhoneNumberId });
        if (resolvedTenant.unknownChannel) {
          // Canal não identificado (Bloco 2.B, revisão de segurança 06/08/2026):
          // nunca gravar em tenant nenhum quando não dá pra provar de quem é a
          // mensagem — evita repetir o vazamento cross-tenant que existia
          // quando isso caía silenciosamente no tenant legado.
          console.warn(`⚠️  [Webhook ${msg.provider}] Mensagem ${msg.messageId} de canal desconhecido (phone_number_id="${msg.phoneNumberId}") — descartada sem gravar em nenhum tenant.`);
          continue;
        }
        const { tenantId } = resolvedTenant;
        await runWithTenantDbContext(
          { tenantId, source: 'webhook' },
          async () => {

        // Eco fromMe:true (só Evolution API — Baileys espelha TODA atividade
        // do número conectado, inclusive nosso próprio envio via API). Nunca
        // dispara resposta automática/escalonamento: ou é confirmação de
        // algo que a gente mesma já mandou e já gravou (descarta), ou foi
        // mandado direto do celular fora do painel — nesse caso vira
        // mensagem nova (sentBy='operator'), senão ficaria invisível tanto
        // pro operador quanto pro contexto futuro do agente (achado real).
        // Ver server/services/outboundEchoTracker.ts.
        if (msg.fromMe) {
          if (msg.type === 'text' || msg.type === 'audio' || msg.type === 'image') {
            const alreadyOurs = await consumePendingEcho(tenantId, msg.from, msg.type, msg.type === 'text' ? msg.text : undefined);
            if (!alreadyOurs) {
              if (msg.type === 'text' && msg.text) {
                await recordOutgoingMessage(tenantId, msg.from, { type: 'text', text: msg.text, timestamp: nowLabel }, 'operator', undefined, undefined, msg.messageId);
              } else if (msg.type === 'audio' || msg.type === 'image') {
                const placeholderText = msg.type === 'audio' ? '🎤 Áudio enviado' : '📷 Imagem enviada';
                await recordOutgoingMessage(tenantId, msg.from, { type: msg.type, text: placeholderText, timestamp: nowLabel }, 'operator', undefined, undefined, msg.messageId);
                downloadEvolutionMedia(
                  { id: msg.messageId, remoteJid: `${msg.from}@s.whatsapp.net` },
                  resolvedTenant.evolutionInstanceName,
                  resolvedTenant.evolutionApiUrl,
                  resolvedTenant.evolutionApiKey
                )
                  .then((downloaded) => saveMediaImage(supabaseUrl, supabaseKey, msg.messageId, downloaded.base64, downloaded.mimeType))
                  .catch((err) => console.warn(`❌ [Eco de envio] Falha ao baixar mídia mandada direto do celular (${msg.from}):`, err.message));
              }
              console.log(`📱 [Eco de envio] tenant=${tenantId} mensagem mandada direto do celular (fora do painel) pra ${msg.from} — gravada como operador.`);
            }
          }
          return;
        }

        if (msg.referral?.ctwaClid) {
          attachAdReferralIfMissing(tenantId, msg.from, { ctwaClid: msg.referral.ctwaClid, adSourceId: msg.referral.sourceId, adHeadline: msg.referral.headline }).catch((err) =>
            console.warn(`⚠️  [Webhook ${msg.provider}] Falha ao gravar ctwa_clid de ${msg.from}:`, err.message)
          );
        }

        // Acompanhamento de funil — o cliente respondeu de novo (qualquer
        // tipo de mensagem real, não eco), então "sumiu esperando escolher"
        // não se aplica mais. Só cancela 'customer_reply' (esperando
        // avaliação da dona do negócio é outra coisa, resolve só quando um
        // humano marcar o escalonamento como resolvido). Nunca lança —
        // rede de segurança extra, não pode travar o processamento real da
        // mensagem.
        clearPendingFollowUp(tenantId, msg.from, 'customer_reply').catch((err) =>
          console.warn(`⚠️  [Acompanhamento de funil] Falha ao cancelar pendência de ${msg.from}:`, err.message)
        );

        // TASK-0171 — só relevante se a conversa ainda nem existir (alguém
        // mandando mensagem direto pra um número de disparo antes de
        // qualquer campanha) — ver getOrCreateConversationRow.
        const inboundMetaPhoneNumberId = resolvedTenant.provider === 'meta' ? resolvedTenant.metaPhoneNumberId : undefined;

        if (msg.type === 'audio') {
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'audio', text: '🎤 Transcrevendo áudio...', timestamp: nowLabel }, msg.messageId, undefined, inboundMetaPhoneNumberId);
          enqueueTranscriptionJob(msg, resolvedTenant);
          enqueued += 1;
        } else if (msg.type === 'text') {
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'text', text: msg.text, timestamp: nowLabel }, undefined, undefined, inboundMetaPhoneNumberId);
          if (msg.text && isPaymentRelated(msg.text)) {
            await logEscalation(tenantId, msg.from, msg.contactName, 'Mensagem sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana', msg.text);
          }
          if (msg.text && looksLikeHarassment(msg.text)) {
            await logEscalation(tenantId, msg.from, msg.contactName, '🚫 Mensagem de conteúdo pessoal/romântico dirigido à assistente — possível assédio, considere bloquear a IA pra este contato (menu ⋮ na conversa)', msg.text);
          }
          if (msg.text) handleIncomingText(msg.from, msg.contactName, msg.text, msg.messageId, resolvedTenant);
        } else if (msg.type === 'image') {
          // Achado real (28/08/2026): quando o cliente manda a foto já com uma
          // legenda digitada, o texto era descartado — a conversa mostrava só
          // "📷 Imagem recebida", sem a legenda de verdade. msg.caption (ver
          // webhookParsers.ts) preserva o que o cliente escreveu; a UI
          // (WhatsAppLeadsSim.tsx) já mostra esse texto como legenda abaixo da
          // foto, então só precisa chegar até aqui.
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'image', text: msg.caption || '📷 Imagem recebida', timestamp: nowLabel }, msg.messageId, undefined, inboundMetaPhoneNumberId);

          // Uma única promise de download, reaproveitada abaixo (await duas
          // vezes na mesma promise não baixa a imagem de novo) — mantém o
          // salvamento da imagem incondicional (toda imagem recebida
          // continua salva pro painel exibir, igual antes) e ainda dá pra
          // reusar os mesmos bytes pra análise de comprovante sem duplicar o
          // download.
          const downloadPromise = msg.metaImage
            ? downloadMetaMedia(msg.metaImage.mediaId, resolvedTenant.metaAccessToken)
            : msg.evolutionImage
            ? downloadEvolutionMedia(
                { id: msg.messageId, remoteJid: `${msg.from}@s.whatsapp.net` },
                resolvedTenant.evolutionInstanceName,
                resolvedTenant.evolutionApiUrl,
                resolvedTenant.evolutionApiKey
              )
            : null;
          if (downloadPromise) {
            downloadPromise
              .then((downloaded) => saveMediaImage(supabaseUrl, supabaseKey, msg.messageId, downloaded.base64, downloaded.mimeType))
              .catch((err) => console.warn(`❌ [Imagem] Falha ao baixar imagem de ${msg.from}:`, err.message));
          }

          // Etapa 8 (fluxo de verificação de pagamento) — uma imagem chegando
          // com um agendamento ativo ainda sem comprovante registrado é o
          // caso mais comum de "cliente mandou o comprovante da seña". Nunca
          // confirma nada sozinho: só marca pending_verification e escala pra
          // um operador olhar de verdade (ver server/services/appointmentStore.ts).
          //
          // Achado (pergunta real do dono do produto): antes disso o sistema
          // nunca olhava o CONTEÚDO da imagem, só o contexto (tem agendamento
          // ativo sem pagamento? então é "possível comprovante"). Agora, só
          // nesse caso específico (não em toda imagem — custo de Gemini
          // controlado), manda a mesma imagem já baixada pro Gemini analisar
          // e devolve uma dica curta ("parece um comprovante de Gs 50.000,
          // 12/08") pro operador decidir mais rápido — a decisão final
          // continua sendo sempre humana.
          getAppointmentForPhone(tenantId, msg.from)
            .then(async (appointment) => {
              // Issue #289: 'awaiting_payment' é o estado normal de uma
              // reserva que ainda não tem evento real no Calendar,
              // esperando exatamente esta imagem chegar — não é "já tem
              // comprovante registrado" (esse continua sendo qualquer outro
              // valor de paymentStatus).
              if (!appointment || (appointment.paymentStatus && appointment.paymentStatus !== 'awaiting_payment')) return;
              let receiptHint: string | undefined;
              if (downloadPromise) {
                try {
                  const downloaded = await downloadPromise;
                  const analysis = await analyzePaymentReceiptWithGemini(getAi?.() ?? null, downloaded.base64, downloaded.mimeType);
                  receiptHint = analysis?.hint || undefined;
                } catch (err: any) {
                  console.warn(`❌ [Imagem] Falha ao analisar possível comprovante de ${msg.from}:`, err.message);
                }
              }
              await markPaymentPendingVerification(tenantId, msg.from, msg.messageId, receiptHint);
              const hintSuffix = receiptHint ? ` IA: "${receiptHint}"` : '';
              await logEscalation(tenantId, msg.from, msg.contactName, `Possível comprovante de pagamento recebido (imagem com agendamento ativo) — precisa de verificação humana antes de confirmar o turno.${hintSuffix}`, '[imagem]', 'payment_proof');

              // A imagem e a dica da IA viram um item de revisão na Central de
              // Qualidade. A auditoria é efeito secundário: se a migration ainda
              // não estiver aplicada ou houver indisponibilidade temporária, o
              // comprovante continua escalado e o atendimento não é bloqueado.
              void createQualityReview({
                tenantId,
                kind: 'ai_suggestion',
                title: 'Possível comprovante recebido no WhatsApp',
                description: receiptHint || 'Imagem recebida com agendamento aguardando pagamento; validar manualmente antes de confirmar.',
                context: {
                  decision: 'pending',
                  source: 'payment_receipt',
                  messageId: msg.messageId,
                  requiresHumanReview: true,
                  mediaStored: Boolean(downloadPromise),
                },
                originalValue: receiptHint || null,
                createdBy: null,
              }).then((review) => recordQualityAuditEvent({
                tenantId,
                eventType: 'payment_receipt_detected',
                source: 'whatsapp_webhook',
                entityType: 'quality_review',
                entityId: review.id,
                conversationPhone: msg.from,
                payload: {
                  messageId: msg.messageId,
                  receiptHint: receiptHint || null,
                  paymentStatus: 'pending_verification',
                  requiresHumanReview: true,
                },
              })).catch((err) => console.warn(`⚠️ [Auditoria] Não foi possível registrar a revisão do comprovante ${msg.messageId}:`, err?.message || err));
            })
            .catch((err) => console.warn(`❌ [Pagamento] Falha ao processar possível comprovante de ${msg.from}:`, err.message));
        } else {
          // Tipo de mensagem que não geramos resposta automática (sticker,
          // vídeo/gif, localização, reação, contato etc.) — grava com um
          // rótulo que descreve o que realmente chegou, em vez do
          // "[sticker]"/"[video]" cru de antes (achado real em produção).
          await recordIncomingMessage(tenantId, msg.from, msg.contactName, { type: 'text', text: friendlyLabelForOtherType(msg.rawType), timestamp: nowLabel }, undefined, undefined, inboundMetaPhoneNumberId);
        }
          }
        );
      } catch (err: any) {
        await unmarkProcessed(msg.messageId);
        console.error(`❌ [Webhook ${msg.provider}] Falha ao processar mensagem ${msg.messageId} de ${msg.from} — desmarcada pra reentrega tentar de novo:`, err.message);
      }
    }
    return enqueued;
  };

  const handleWebhookVerification = (req: any, res: any) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = metaWebhookVerifyToken;

    if (challenge) {
      if (mode !== 'subscribe' || !token || token !== verifyToken) {
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

  // `requireMetaSignature` distingue rotas que a Meta de fato assina
  // (WhatsApp Cloud API oficial, Instagram) de rotas de outras origens que
  // batem no mesmo handler genérico (Evolution API/Baileys, self-hosted).
  // Incidente real em produção (25/08/2026, ~62h de mensagens descartadas
  // em silêncio): antes desta distinção, esta checagem HMAC (fail-closed,
  // corrigida em 13/08 pra não pular a validação quando o header vem
  // ausente) rodava incondicionalmente pras 4 rotas — mas a Evolution API
  // nunca envia `x-hub-signature-256`/`x-hub-signature` (não é a Meta, é um
  // gateway próprio autenticado por `apikey`), então assim que
  // META_APP_SECRET passou a estar configurada de verdade em produção,
  // TODO webhook da Evolution começou a ser rejeitado com 403 — não só o de
  // quem tentasse forjar payload, também o tráfego real. A verificação de
  // assinatura só faz sentido pra quem a Meta realmente assina.
  const handleWebhookPayload = async (req: any, res: any, requireMetaSignature: boolean) => {
    // Achado numa auditoria externa: a checagem só rodava "se o header
    // vier" — um POST sem x-hub-signature-256/x-hub-signature pulava a
    // validação inteira e era processado como legítimo (fail-open), mesmo
    // com o app secret configurado. Isso permitia forjar mensagens de
    // WhatsApp inteiras só omitindo o header. Corrigido pra fail-closed:
    // com o secret configurado, o header é obrigatório — mas só pras
    // rotas que a Meta realmente assina (ver `requireMetaSignature` acima).
    const signatureHeader = (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature']) as string | undefined;
    const appSecret = metaAppSecret;

    if (requireMetaSignature && appSecret) {
      if (!signatureHeader) {
        console.warn('❌ Webhook Meta: assinatura ausente com app secret configurado. Rejeitando requisição.');
        return res.status(403).json({ error: 'Assinatura ausente.' });
      }
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

      const parsedMessages = parseEvolutionWebhookPayload(body);
      const enqueued = await enqueueAudioMessages(parsedMessages);

      console.log(`📱 [Evolution Webhook ${instance}] Evento: ${eventName}`, data?.key ? `(Key: ${data.key.id})` : '', enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');

      return res.status(200).json({
        success: true,
        instance,
        event: eventName,
        message: 'Evento Evolution API processado com sucesso',
        timestamp: new Date().toISOString()
      });
    }

    // 2. Instagram DM (Fase 1, 15/08/2026) — mesma Meta App/assinatura HMAC
    // acima (a Meta assina todos os produtos de webhook igual — WhatsApp,
    // Instagram, Messenger), payload em formato "Messenger Platform"
    // (entry[].messaging[]), diferente do formato da Meta Cloud API abaixo.
    if (body?.object === 'instagram') {
      const parsedMessages = parseInstagramWebhookPayload(body);
      const enqueued = await enqueueAudioMessages(parsedMessages);

      const firstMessaging = body.entry?.[0]?.messaging?.[0];
      if (firstMessaging) {
        console.log(`📸 [Webhook Instagram] Nova mensagem de ${firstMessaging.sender?.id}:`, firstMessaging.message?.text ? redactMessageForLog(firstMessaging.message.text) : '[Anexo]', enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
      }

      return res.status(200).json({
        success: true,
        message: 'Evento do Instagram processado com sucesso',
        processedMessages: parsedMessages.length,
      });
    }

    // 3. Meta WhatsApp Cloud API Format
    if (body?.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      const parsedMessages = parseMetaWebhookPayload(body);
      const enqueued = await enqueueAudioMessages(parsedMessages);

      if (messages && messages.length > 0) {
        const msg = messages[0];
        // tenant ainda não resolvido neste ponto (resolução acontece por
        // mensagem dentro de enqueueAudioMessages) — log de diagnóstico do
        // payload bruto, conteúdo sempre redigido.
        console.log(`📱 [Webhook Meta WhatsApp] Nova mensagem de ${msg.from}:`, msg.text?.body ? redactMessageForLog(msg.text.body) : `[Tipo: ${msg.type}]`, enqueued ? `— ${enqueued} áudio(s) enfileirado(s)` : '');
      }

      // Achado ao investigar "o áudio sai mas não chega" ao vivo: o webhook
      // da Meta manda `value.statuses[]` pra reportar sent/delivered/read/
      // failed de mensagens QUE NÓS ENVIAMOS — nunca era lido, então uma
      // falha de entrega reportada pela própria Meta (ex: código de erro
      // específico) ficava invisível pra sempre, mesmo com upload+send
      // retornando 200 na hora do envio (esse 200 só confirma que entrou na
      // fila, não que chegou de verdade no destinatário).
      const statuses = value?.statuses;
      if (Array.isArray(statuses) && statuses.length > 0) {
        for (const status of statuses) {
          const errors = Array.isArray(status?.errors) ? status.errors : [];
          if (status?.status === 'failed' || errors.length > 0) {
            console.warn(
              `❌ [Webhook Meta WhatsApp] Status "${status?.status}" pra mensagem ${status?.id} (recipient=${status?.recipient_id}):`,
              JSON.stringify(errors).slice(0, 500)
            );
          } else {
            console.log(`📬 [Webhook Meta WhatsApp] Status "${status?.status}" pra mensagem ${status?.id} (recipient=${status?.recipient_id})`);
          }
        }
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
  // `/api/webhooks/evolution` é a única rota que a Evolution API de fato
  // chama (ver `setEvolutionWebhook` em admin.ts) — ela nunca assina com
  // HMAC da Meta, então não exige a assinatura. As demais são rotas da
  // Meta (WhatsApp Cloud API oficial/Instagram) ou aliases legados dela,
  // que a Meta sempre assina — mantêm a exigência.
  router.get('/webhook', handleWebhookVerification);
  router.post('/webhook', (req, res) => handleWebhookPayload(req, res, true));

  router.get('/api/webhooks/meta', handleWebhookVerification);
  router.post('/api/webhooks/meta', (req, res) => handleWebhookPayload(req, res, true));

  router.get('/api/webhooks/evolution', handleWebhookVerification);
  router.post('/api/webhooks/evolution', (req, res) => handleWebhookPayload(req, res, false));

  router.get('/api/webhooks/whatsapp', handleWebhookVerification);
  router.post('/api/webhooks/whatsapp', (req, res) => handleWebhookPayload(req, res, true));

  // Alias só pra clareza ao cadastrar o webhook do produto Instagram no App
  // da Meta — mesmo handler genérico acima, que já despacha por body.object.
  router.get('/api/webhooks/instagram', handleWebhookVerification);
  router.post('/api/webhooks/instagram', (req, res) => handleWebhookPayload(req, res, true));

  return router;
}
