import type { GoogleGenAI } from '@google/genai';
import { transcribeAudio, isRealTranscriptionSource, type TranscribeAudioOutcome } from './geminiTranscription';
import { downloadMetaMedia, downloadEvolutionMedia } from './mediaDownload';
import { updateMessageText, recordOutgoingMessage, getConversation, markGeoRestricted, shouldBlockForAdsOnlyMode, attachCatalogClickIfMatched, markSpecialistInvoked } from './conversationStore';
import { emitAiReplyStatus } from './conversationEvents';
import { saveMediaImage } from './mediaImageStore';
import { sendBubbles, type OutboundChannel } from './sendBubbles';
import { isGeoRestrictedError } from './metaSend';
import { compensateApprovedCalendarExecution, executeApprovedCalendarActions, generateAutoReplyForText } from './autoReply';
import { isAgentPaused } from './agentStatus';
import { runExclusive } from './perPhoneQueue';
import { getRuntimeKnowledgeBase, formatKnowledgeBaseForPrompt } from './knowledgeBaseStore';
import { getTenantSegment } from './tenantProfileStore';
import { logEscalation, isPaymentRelated, looksLikeHarassment, bookingConfirmationEscalationSourceKey } from './escalationStore';
import { redactMessageForLog } from './logRedaction';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';
import { isPlausiblePersonalName } from './contactNameGuard';
import { runWithTenantDbContext } from './tenantDbContext';
import type { ResolvedTenant } from './tenantResolver';
import type { ParsedIncomingMessage } from './webhookParsers';
import { bufferIncomingAudioText, startAudioBufferRecoverySweeper, takePendingAudioBufferTexts } from './audioMessageBuffer';
import { markGenerating, unmarkGenerating } from './generatingLock';

export interface TranscriptionJob {
  message: ParsedIncomingMessage;
  /** Tenant/credencial já resolvidos (Bloco 2.B) no momento em que o job entrou na fila. */
  resolvedTenant: ResolvedTenant;
  createdAt: string;
}

export interface TranscriptionJobResult {
  job: TranscriptionJob;
  status: 'completed' | 'failed';
  outcome?: TranscribeAudioOutcome;
  error?: string;
  finishedAt: string;
  latencyMs: number;
}

export interface TranscriptionQueueDeps {
  getAi: () => GoogleGenAI | null;
  /** Router fallback Groq (plano aprovado) — ver classifyAgent em autoReply.ts. Opcional: sem ela, o router usa só o Gemini como sempre. */
  groqApiKey?: string;
  metaAccessToken?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  metaPhoneNumberId?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

/**
 * Fila de processamento assíncrono em memória — os webhooks respondem 200
 * na hora, o download+transcrição roda em background por um worker único.
 * Sem persistência: se o processo reiniciar, jobs pendentes se perdem.
 * Substituir por Redis/BullMQ é a Fase 5 (Epic 5.1), quando o volume real
 * justificar múltiplos workers e reentrega garantida.
 */
const queue: TranscriptionJob[] = [];
const recentResults: TranscriptionJobResult[] = [];
const MAX_RECENT_RESULTS = 200;
let totalProcessed = 0;
let totalFailed = 0;
let workerStarted = false;

export function enqueueTranscriptionJob(message: ParsedIncomingMessage, resolvedTenant: ResolvedTenant) {
  queue.push({ message, resolvedTenant, createdAt: new Date().toISOString() });
}

export function getQueueStats() {
  const latencies = recentResults.slice(0, 50).map((r) => r.latencyMs);
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  return {
    activeWorkers: workerStarted ? 1 : 0,
    pendingQueue: queue.length,
    processedTotal: totalProcessed,
    failedTotal: totalFailed,
    avgLatencyMs,
  };
}

export function startTranscriptionWorker(deps: TranscriptionQueueDeps) {
  if (workerStarted) return;
  workerStarted = true;
  void processLoop(deps);
  // TASK-0430 — recupera lotes de áudio presos por um restart de deploy no
  // meio da janela de silêncio, mesmo princípio de
  // webhooks.ts/startBufferRecoverySweeper pro caminho de texto.
  startAudioBufferRecoverySweeper((phone) => (combinedText, bufferedContactName, lastMessageId, messageCount, resolvedTenant, firstMessageId) =>
    generateAndSendAudioReply(resolvedTenant, deps, phone, combinedText, bufferedContactName, lastMessageId, messageCount, firstMessageId)
  );
}

async function processLoop(deps: TranscriptionQueueDeps) {
  // Loop infinito e deliberado: é o worker da fila, roda pela vida do processo.
  for (;;) {
    const job = queue.shift();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    await processJob(job, deps);
  }
}

/**
 * Exportado só pra teste direto (TASK-0209) — o worker real só é alcançável via startTranscriptionWorker/enqueueTranscriptionJob (loop infinito, difícil de testar sem fake timers frágeis).
 *
 * Achado real de produção (03/09/2026): este worker roda no loop assíncrono
 * separado de `processLoop` (setTimeout entre iterações), fora da cadeia de
 * qualquer requisição HTTP/webhook — nunca herdava o `TenantDbContext`
 * (AsyncLocalStorage, ver `tenantDbContext.ts`) que `getDb()` exige pra
 * liberar acesso sob RLS. Resultado: TODO áudio recebido de qualquer tenant
 * ficava travado pra sempre no placeholder "🎤 Transcrevendo áudio..." — a
 * chamada de verdade (`updateMessageText`, `getKnowledgeBase`, etc.) sempre
 * falhava com "Acesso ao banco sem contexto de tenant... recusado pra
 * preservar RLS", capturado silenciosamente pelo catch abaixo (só um log de
 * warning, nunca reportado ao operador). Todos os outros jobs em background
 * do projeto (`messageBuffer.ts`, `pendingFollowUpJob.ts`, etc.) já
 * envolvem seu próprio trabalho em `runWithTenantDbContext({..., source:
 * 'job'})` — só este ficou de fora. Os testes existentes não pegaram isso
 * porque mockam a camada de dados inteira, nunca exercitando o `getDb()`
 * real.
 */
export async function processJob(job: TranscriptionJob, deps: TranscriptionQueueDeps) {
  const { resolvedTenant } = job;
  return runWithTenantDbContext({ tenantId: resolvedTenant.tenantId, source: 'job' }, () => processJobWithTenantContext(job, deps));
}

/**
 * TASK-0430 — corpo da geração+envio da resposta automática pro lote
 * (combinado pelo buffer de áudio, audioMessageBuffer.ts) já agrupado de um
 * ou mais áudios da mesma janela de silêncio. Extraído numa função própria
 * pra ser reaproveitado tanto pelo flush normal (dentro de
 * processJobWithTenantContext, logo abaixo) quanto pelo sweeper de
 * recuperação pós-restart (startTranscriptionWorker) — mesmo princípio de
 * webhooks.ts/triggerAutoReply pro caminho de texto.
 */
async function generateAndSendAudioReply(
  resolvedTenant: ResolvedTenant,
  deps: TranscriptionQueueDeps,
  phone: string,
  combinedTextArg: string,
  bufferedContactName: string | undefined,
  lastMessageIdArg: string,
  messageCountArg: number,
  firstMessageId: string
): Promise<void> {
  const { tenantId, metaAccessToken: token, metaPhoneNumberId: phoneNumberId } = resolvedTenant;
  const isEvolution = resolvedTenant.provider === 'evolution';
  const channel: OutboundChannel = isEvolution
    ? { provider: 'evolution', evolutionInstanceName: resolvedTenant.evolutionInstanceName, evolutionApiUrl: resolvedTenant.evolutionApiUrl, evolutionApiKey: resolvedTenant.evolutionApiKey }
    : { provider: 'meta', phoneNumberId, accessToken: token };
  await runExclusive(phone, async () => {
    if (await isAgentPaused(tenantId)) return;
    const conversation = await getConversation(tenantId, phone);
    // Mesmo bloqueio por lead individual do caminho de texto (ver
    // webhooks.ts triggerAutoReply) — um lead bloqueado não deve
    // receber resposta automática nem quando manda áudio.
    if (conversation?.aiBlockedAt) return;
    // Mesmo gate do caminho de texto (ver webhooks.ts triggerAutoReply) —
    // modo "somente anúncios" também vale pra áudio, usando a
    // transcrição (já combinada, se houve rajada) como o texto a
    // comparar com os gatilhos configurados.
    await attachCatalogClickIfMatched(tenantId, phone, combinedTextArg);
    if (await shouldBlockForAdsOnlyMode(tenantId, phone, combinedTextArg)) return;
    const kbContext = formatKnowledgeBaseForPrompt((await getRuntimeKnowledgeBase(tenantId)).knowledgeBase);
    const segment = await getTenantSegment(tenantId);
    // TASK-0209/TASK-0430 — corta por IDENTIDADE (o messageId do PRIMEIRO
    // áudio deste lote, não mais o de um áudio isolado) — permanece
    // correto mesmo com mensagem nova chegando enquanto o lote esperava a
    // janela de silêncio; cai no corte antigo por posição só se o id não
    // for encontrado.
    const allMessages = conversation?.messages;
    const cutoffIndex = allMessages ? allMessages.findIndex((m) => m.id === firstMessageId) : -1;
    const history = !allMessages ? undefined : cutoffIndex !== -1 ? allMessages.slice(0, cutoffIndex) : allMessages.slice(0, -messageCountArg);
    // Mesmo sinal pro painel do caminho de texto (ver triggerAutoReply em webhooks.ts).
    emitAiReplyStatus(tenantId, phone, 'generating');
    // TASK-0431 — mesmo princípio do caminho de texto (webhooks.ts): marca
    // que uma geração pro MESMO telefone está em andamento, pra que
    // bufferIncomingAudioText/bufferIncomingText adiem seu próprio flush em
    // vez de disparar por conta própria e virar um ciclo independente e
    // redundante. Desmarcado no finally.
    markGenerating(tenantId, phone);
    // TASK-0416 — ver StoredConversation.specialistInvokedAt em
    // conversationStore.ts: history vazio não basta pra saber se é a 1ª
    // vez que o especialista roda de verdade.
    const specialistInvokedBefore = !!conversation?.specialistInvokedAt;
    let combinedText = combinedTextArg;
    let lastMessageId = lastMessageIdArg;
    let messageCount = messageCountArg;
    try {
      let result = await generateAutoReplyForText(
        tenantId,
        deps.getAi(),
        combinedText,
        bufferedContactName,
        kbContext,
        history,
        phone,
        undefined,
        segment,
        isEvolution ? undefined : { phoneNumberId, accessToken: token },
        undefined,
        undefined,
        undefined,
        deps.groqApiKey,
        messageCount,
        undefined,
        specialistInvokedBefore
      );
      await markSpecialistInvoked(tenantId, phone);

      // TASK-0431 (mesmo princípio de TASK-0418 no caminho de texto): a
      // cliente pode ter mandado mais áudio(s) ENQUANTO esta resposta era
      // gerada — agora que o flush adia enquanto isGenerating for true (ver
      // generatingLock.ts/audioMessageBuffer.ts), esse texto ainda está
      // esperando no buffer nesse momento. Absorve e regenera incluindo
      // tudo, em vez de deixar o outro ciclo rodar depois, de forma
      // independente e redundante.
      if (result) {
        const pendingExtra = takePendingAudioBufferTexts(tenantId, phone);
        if (pendingExtra?.texts.length) {
          console.warn(`🔁 [Resposta Automática] tenant=${tenantId} absorveu áudio novo de ${phone} chegado durante a geração — regenerando com o texto completo.`);
          combinedText = [combinedText, ...pendingExtra.texts].join('\n');
          lastMessageId = pendingExtra.lastMessageId;
          messageCount += pendingExtra.texts.length;
          result = await generateAutoReplyForText(
            tenantId,
            deps.getAi(),
            combinedText,
            bufferedContactName,
            kbContext,
            history,
            phone,
            undefined,
            segment,
            isEvolution ? undefined : { phoneNumberId, accessToken: token },
            undefined,
            undefined,
            undefined,
            deps.groqApiKey,
            messageCount,
            undefined,
            specialistInvokedBefore
          );
          await markSpecialistInvoked(tenantId, phone);
        }
      }
      if (!result) {
        await logEscalation(tenantId, phone, bufferedContactName, 'IA não conseguiu gerar resposta automática pro áudio', combinedText);
        emitAiReplyStatus(tenantId, phone, 'failed');
        return;
      }
      // TASK-0411 — mesmo tratamento do caminho de texto (webhooks.ts):
      // decisão deliberada de não responder (fora do escopo definido nas
      // Regras de negócio do tenant), nunca uma falha.
      if (result.outOfScope) {
        emitAiReplyStatus(tenantId, phone, 'skipped_out_of_scope');
        return;
      }
      const safety = await reviewAutoReplyBeforeSend({
        customerMessage: combinedText,
        draftBubbles: result.bubbles,
        history,
        knowledgeContext: kbContext,
        isBookingFlow: result.agent === 'agendamento',
        needsHumanConfirmation: result.needsHumanConfirmation,
        plannedCalendarActions: result.deferredCalendarActions?.map((action) => action.summary),
        contactName: isPlausiblePersonalName(bufferedContactName) ? bufferedContactName : undefined,
      }, { ai: deps.getAi(), groqApiKey: deps.groqApiKey });
      if (!safety.approved) {
        const blockedDraft = result.bubbles.join(' / ').slice(0, 900);
        await logEscalation(
          tenantId,
          phone,
          bufferedContactName,
          `Revisor pré-envio bloqueou a resposta automática de áudio (${safety.source}, risco ${safety.severity}): ${safety.reason} Rascunho bloqueado: ${blockedDraft}`,
          combinedText
        );
        console.warn(`🛡️ [Revisor pré-envio] tenant=${tenantId} bloqueou resposta de áudio para ${phone}: ${safety.reason}`);
        emitAiReplyStatus(tenantId, phone, 'failed');
        return;
      }
      // TASK-0297: quando o revisor corrige em vez de só aprovar/bloquear
      // (hoje só remove uma bolha isolada de empurrão de agenda depois de
      // pergunta informativa), envia a versão corrigida — nunca o rascunho
      // original nesse caso.
      const bubblesToSend = safety.correctedBubbles ?? result.bubbles;
      const calendarExecution = await executeApprovedCalendarActions(
        tenantId,
        phone,
        undefined,
        result.deferredCalendarActions,
        bufferedContactName,
        lastMessageId,
      );
      if (calendarExecution.hadError) {
        const reason = calendarExecution.summaries.join(' ');
        await logEscalation(tenantId, phone, bufferedContactName, `Ação de agenda aprovada pelo revisor, mas não foi concluída antes do envio: ${reason}`, combinedText, 'general', { sourceKey: bookingConfirmationEscalationSourceKey(phone) });
        emitAiReplyStatus(tenantId, phone, 'failed');
        return;
      }
      if (result.agent === 'reclamacao') {
        await logEscalation(tenantId, phone, bufferedContactName, 'Cliente com reclamação — atendimento humano obrigatório, IA nunca resolve reclamação sozinha', combinedText);
      } else if (result.agent === 'agendamento' && result.needsHumanConfirmation) {
        await logEscalation(tenantId, phone, bufferedContactName, 'Cliente tentando fechar agendamento — confirmar disponibilidade real (ainda sem Google Calendar conectado)', combinedText, 'general', { sourceKey: bookingConfirmationEscalationSourceKey(phone) });
      }
      try {
        await sendBubbles(channel, phone, bubblesToSend, async (bubbleText) => {
          await recordOutgoingMessage(tenantId, phone, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
          console.log(`🤖 [Resposta Automática] tenant=${tenantId} Enviado pra ${phone}: ${redactMessageForLog(bubbleText)} (agente: ${result.agent})`);
        }, lastMessageId, result.phase, result.routerElapsedMs, result.quickReplyOptions);
      } catch (sendError: any) {
        let compensation = 'Não foi possível iniciar a compensação automática.';
        try {
          compensation = await compensateApprovedCalendarExecution(tenantId, phone, calendarExecution);
        } catch (compensationError: any) {
          compensation = `A compensação automática falhou: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`;
        }
        await logEscalation(tenantId, phone, bufferedContactName, `Falha ao enviar resposta após ação de agenda aprovada: ${sendError instanceof Error ? sendError.message : String(sendError)}. ${compensation}`, combinedText);
        console.warn(`⚠️ [Agenda pós-envio] tenant=${tenantId} ${compensation}`);
        emitAiReplyStatus(tenantId, phone, 'failed');
        return;
      }
      emitAiReplyStatus(tenantId, phone, 'sent');
    } catch (err: any) {
      emitAiReplyStatus(tenantId, phone, 'failed');
      if (isGeoRestrictedError(err)) {
        await markGeoRestricted(tenantId, phone, err.message);
        await logEscalation(tenantId, phone, bufferedContactName, 'Envio bloqueado por restrição geográfica — precisa de atendimento manual', combinedText);
      } else {
        await logEscalation(tenantId, phone, bufferedContactName, `Falha ao responder automaticamente: ${err.message}`, combinedText);
      }
      console.warn('❌ [Resposta Automática] Falhou:', err.message);
    } finally {
      unmarkGenerating(tenantId, phone);
    }
  });
}

async function processJobWithTenantContext(job: TranscriptionJob, deps: TranscriptionQueueDeps) {
  const startedAt = Date.now();
  const { message, resolvedTenant } = job;
  const { tenantId, metaAccessToken: token } = resolvedTenant;

  try {
    let audioBase64: string | undefined;
    let mimeType: string | undefined;

    if (message.type === 'audio' && message.metaAudio) {
      const downloaded = await downloadMetaMedia(message.metaAudio.mediaId, token);
      audioBase64 = downloaded.base64;
      mimeType = downloaded.mimeType;
    } else if (message.type === 'audio' && message.evolutionAudio) {
      // Instância/URL/API key já vêm resolvidas por tenant (resolveTenantByEvolutionInstance,
      // Epic 4.6) — não mais a instância global única fixa em deps.*.
      const downloaded = await downloadEvolutionMedia(
        { id: message.messageId, remoteJid: `${message.from}@s.whatsapp.net` },
        resolvedTenant.evolutionInstanceName,
        resolvedTenant.evolutionApiUrl,
        resolvedTenant.evolutionApiKey
      );
      audioBase64 = downloaded.base64;
      mimeType = downloaded.mimeType;
    } else {
      throw new Error(`Mensagem tipo "${message.type}" não é áudio — nada a transcrever.`);
    }

    // Achado real em produção ("o áudio não fica na conversa"): o download
    // acima existia só pra alimentar a transcrição — os bytes reais nunca
    // eram guardados em lugar nenhum, então o painel nunca conseguia tocar
    // de volta o áudio original do cliente, só ler a transcrição em texto.
    // Mesmo bucket/rota já usados pra imagem recebida (GET
    // /api/media/:messageId), indexado pelo mesmo message_id da mensagem já
    // gravada (recordIncomingMessage em webhooks.ts).
    await saveMediaImage(deps.supabaseUrl, deps.supabaseKey, message.messageId, audioBase64!, mimeType || 'audio/ogg');

    const outcome = await transcribeAudio(deps.getAi(), audioBase64, mimeType, {
      leadName: message.contactName,
      customInstructions: formatKnowledgeBaseForPrompt((await getRuntimeKnowledgeBase(tenantId)).knowledgeBase),
      groqApiKey: deps.groqApiKey,
    });

    // Achado real de auditoria (29/08/2026): um áudio sem fala nenhuma
    // (silêncio) voltava com source: 'gemini' (chamada teve sucesso técnico)
    // e uma transcrição inventada e plausível — o guard de "sem fallback
    // inventado" em geminiTranscription.ts só cobria falha da CHAMADA, nunca
    // o caso de sucesso técnico com conteúdo alucinado. O prompt agora pede
    // transcription: "" quando não há fala real; aqui tratamos esse caso
    // exatamente como uma falha técnica — nunca dispara resposta automática,
    // sempre escala pra humano, e grava um texto legível (nunca vazio) no
    // histórico da conversa.
    const hasNoDetectedSpeech = isRealTranscriptionSource(outcome.source) && !outcome.result.transcription?.trim();
    const messageTextForRecord = hasNoDetectedSpeech ? '[Áudio sem fala detectável]' : outcome.result.transcription;

    totalProcessed += 1;
    recordResult({ job, status: 'completed', outcome, finishedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt });
    await updateMessageText(tenantId, message.from, message.messageId, messageTextForRecord);
    console.log(`✅ [Fila de Transcrição] tenant=${tenantId} ${message.provider} ${message.messageId} concluído (source: ${outcome.source}): ${redactMessageForLog(messageTextForRecord)}`);

    if (outcome.source === 'fallback') {
      await logEscalation(tenantId, message.from, message.contactName, 'Falha ao transcrever áudio automaticamente — operador precisa ouvir manualmente', outcome.result.transcription);
    } else if (hasNoDetectedSpeech) {
      await logEscalation(tenantId, message.from, message.contactName, 'Áudio sem fala detectável (silêncio/ruído) — operador precisa ouvir manualmente antes de responder', messageTextForRecord);
    } else if (isPaymentRelated(outcome.result.transcription)) {
      await logEscalation(tenantId, message.from, message.contactName, 'Áudio sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana', outcome.result.transcription);
    } else if (looksLikeHarassment(outcome.result.transcription)) {
      await logEscalation(tenantId, message.from, message.contactName, '🚫 Áudio de conteúdo pessoal/romântico dirigido à assistente — possível assédio, considere bloquear a IA pra este contato (menu ⋮ na conversa)', outcome.result.transcription);
    }

    // Resposta automática (Epic 1.3): só quando a análise veio do Gemini de
    // verdade (não do fallback simulado) E detectou fala real, pra não
    // responder algo genérico nem alucinado em cima de silêncio.
    // Reaproveita o mesmo motor de bolhas/humanização do caminho de texto
    // (generateAutoReplyForText), passando a transcrição como se fosse a
    // mensagem recebida — evita duplicar a lógica de estilo em dois lugares.
    //
    // TASK-0430 — achado real de audit (tenant Monique, cliente "Carmen
    // Bareiro"): antes desta correção, CADA áudio disparava seu próprio
    // ciclo completo de resposta assim que terminava de transcrever, sem
    // nenhum agrupamento (diferente do texto, que já espera ~10s de
    // silêncio via messageBuffer.ts). Uma cliente que manda vários áudios em
    // rajada (comum no WhatsApp) recebia uma resposta por áudio — algumas
    // já desatualizadas pelo tempo que levam pra sair da fila global e
    // única de transcrição — culminando em respostas redundantes/só de
    // despedida repetidas em sequência. bufferIncomingAudioText
    // (audioMessageBuffer.ts) agrupa as transcrições da mesma janela de
    // silêncio antes de disparar UMA resposta pro lote inteiro, com o mesmo
    // princípio (e mesma robustez a restart) do buffer de texto — mas
    // deliberadamente numa tabela/Map próprios, nunca misturando com o
    // buffer de texto.
    if (isRealTranscriptionSource(outcome.source) && !hasNoDetectedSpeech && !(await isAgentPaused(tenantId))) {
      bufferIncomingAudioText(message.from, message.contactName, outcome.result.transcription, message.messageId, resolvedTenant, (combinedText, bufferedContactName, lastMessageId, messageCount, bufferedTenant, firstMessageId) =>
        runWithTenantDbContext(
          { tenantId: bufferedTenant.tenantId, source: 'job' },
          () => generateAndSendAudioReply(bufferedTenant, deps, message.from, combinedText, bufferedContactName, lastMessageId, messageCount, firstMessageId)
        )
      );
    }
  } catch (err: any) {
    totalFailed += 1;
    recordResult({ job, status: 'failed', error: err.message, finishedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt });
    console.warn(`❌ [Fila de Transcrição] tenant=${tenantId} ${message.provider} ${message.messageId} falhou:`, err.message);
  }
}

function recordResult(result: TranscriptionJobResult) {
  recentResults.unshift(result);
  if (recentResults.length > MAX_RECENT_RESULTS) recentResults.length = MAX_RECENT_RESULTS;
}
