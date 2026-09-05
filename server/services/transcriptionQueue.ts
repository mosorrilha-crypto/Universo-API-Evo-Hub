import type { GoogleGenAI } from '@google/genai';
import { transcribeAudioWithGemini, type TranscribeAudioOutcome } from './geminiTranscription';
import { downloadMetaMedia, downloadEvolutionMedia } from './mediaDownload';
import { updateMessageText, recordOutgoingMessage, getConversation, markGeoRestricted, shouldBlockForAdsOnlyMode, attachCatalogClickIfMatched } from './conversationStore';
import { emitAiReplyStatus } from './conversationEvents';
import { saveMediaImage } from './mediaImageStore';
import { sendBubbles, type OutboundChannel } from './sendBubbles';
import { isGeoRestrictedError } from './metaSend';
import { compensateApprovedCalendarExecution, executeApprovedCalendarActions, generateAutoReplyForText } from './autoReply';
import { isAgentPaused } from './agentStatus';
import { runExclusive } from './perPhoneQueue';
import { getRuntimeKnowledgeBase, formatKnowledgeBaseForPrompt } from './knowledgeBaseStore';
import { getTenantSegment } from './tenantProfileStore';
import { logEscalation, isPaymentRelated, looksLikeHarassment } from './escalationStore';
import { redactMessageForLog } from './logRedaction';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';
import { isPlausiblePersonalName } from './contactNameGuard';
import { runWithTenantDbContext } from './tenantDbContext';
import type { ResolvedTenant } from './tenantResolver';
import type { ParsedIncomingMessage } from './webhookParsers';

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

export function getRecentResults(limit = 20) {
  return recentResults.slice(0, limit);
}

export function startTranscriptionWorker(deps: TranscriptionQueueDeps) {
  if (workerStarted) return;
  workerStarted = true;
  void processLoop(deps);
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

async function processJobWithTenantContext(job: TranscriptionJob, deps: TranscriptionQueueDeps) {
  const startedAt = Date.now();
  const { message, resolvedTenant } = job;
  const { tenantId, metaAccessToken: token, metaPhoneNumberId: phoneNumberId } = resolvedTenant;
  const isEvolution = resolvedTenant.provider === 'evolution';
  const channel: OutboundChannel = isEvolution
    ? { provider: 'evolution', evolutionInstanceName: resolvedTenant.evolutionInstanceName, evolutionApiUrl: resolvedTenant.evolutionApiUrl, evolutionApiKey: resolvedTenant.evolutionApiKey }
    : { provider: 'meta', phoneNumberId, accessToken: token };

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

    const outcome = await transcribeAudioWithGemini(deps.getAi(), audioBase64, mimeType, {
      leadName: message.contactName,
      customInstructions: formatKnowledgeBaseForPrompt((await getRuntimeKnowledgeBase(tenantId)).knowledgeBase),
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
    const hasNoDetectedSpeech = outcome.source === 'gemini' && !outcome.result.transcription?.trim();
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
    if (outcome.source === 'gemini' && !hasNoDetectedSpeech && !(await isAgentPaused(tenantId))) {
      runExclusive(message.from, async () => {
        const conversation = await getConversation(tenantId, message.from);
        // Mesmo bloqueio por lead individual do caminho de texto (ver
        // webhooks.ts triggerAutoReply) — um lead bloqueado não deve
        // receber resposta automática nem quando manda áudio.
        if (conversation?.aiBlockedAt) return;
        // Mesmo gate do caminho de texto (ver webhooks.ts triggerAutoReply) —
        // modo "somente anúncios" também vale pra áudio, usando a
        // transcrição como o texto a comparar com os gatilhos configurados.
        await attachCatalogClickIfMatched(tenantId, message.from, outcome.result.transcription);
        if (await shouldBlockForAdsOnlyMode(tenantId, message.from, outcome.result.transcription)) return;
        const kbContext = formatKnowledgeBaseForPrompt((await getRuntimeKnowledgeBase(tenantId)).knowledgeBase);
        const segment = await getTenantSegment(tenantId);
        // TASK-0209 — achado real de auditoria estrutural (mesma classe do
        // TASK-0172, achada aqui no caminho de ÁUDIO): cortar a última
        // posição do array (`slice(0, -1)`) supõe que o próprio áudio é
        // sempre o último item de `conversation.messages`. Mas entre o
        // cliente mandar o áudio (gravado na hora por recordIncomingMessage,
        // em webhooks.ts) e este job rodar (fila serial única de
        // transcrição + download + chamada ao Gemini — latência real de
        // vários segundos, plausivelmente mais que os 10s de silêncio do
        // messageBuffer.ts), o MESMO cliente pode mandar uma mensagem nova
        // — gravada imediatamente, fora desta fila. Quando isso acontece, o
        // corte por posição pega o item errado: mantém o próprio áudio
        // dentro do histórico (duplicado com `outcome.result.transcription`,
        // já passado à parte como a "mensagem atual") e descarta a mensagem
        // nova de verdade do cliente, perdida do contexto. Corta por
        // IDENTIDADE (o messageId real do áudio, já em escopo) — permanece
        // correto mesmo com mensagem nova chegando durante a espera; cai no
        // corte antigo por posição só se o id não for encontrado (não
        // deveria acontecer, updateMessageText já rodou pra esta mensagem
        // logo acima, mas mantém o mesmo fallback do padrão já usado em
        // webhooks.ts/triggerAutoReply).
        const allMessages = conversation?.messages;
        const audioIndex = allMessages ? allMessages.findIndex((m) => m.id === message.messageId) : -1;
        const history = !allMessages ? undefined : audioIndex !== -1 ? allMessages.slice(0, audioIndex) : allMessages.slice(0, -1);
        // Mesmo sinal pro painel do caminho de texto (ver triggerAutoReply em webhooks.ts).
        emitAiReplyStatus(tenantId, message.from, 'generating');
        try {
          const result = await generateAutoReplyForText(
            tenantId,
            deps.getAi(),
            outcome.result.transcription,
            message.contactName,
            kbContext,
            history,
            message.from,
            undefined,
            segment,
            isEvolution ? undefined : { phoneNumberId, accessToken: token },
            undefined,
            undefined,
            undefined,
            deps.groqApiKey
          );
          if (!result) {
            await logEscalation(tenantId, message.from, message.contactName, 'IA não conseguiu gerar resposta automática pro áudio', outcome.result.transcription);
            emitAiReplyStatus(tenantId, message.from, 'failed');
            return;
          }
          const safety = await reviewAutoReplyBeforeSend({
            customerMessage: outcome.result.transcription,
            draftBubbles: result.bubbles,
            history,
            knowledgeContext: kbContext,
            isBookingFlow: result.agent === 'agendamento',
            needsHumanConfirmation: result.needsHumanConfirmation,
            plannedCalendarActions: result.deferredCalendarActions?.map((action) => action.summary),
            contactName: isPlausiblePersonalName(message.contactName) ? message.contactName : undefined,
          }, { ai: deps.getAi(), groqApiKey: deps.groqApiKey });
          if (!safety.approved) {
            const blockedDraft = result.bubbles.join(' / ').slice(0, 900);
            await logEscalation(
              tenantId,
              message.from,
              message.contactName,
              `Revisor pré-envio bloqueou a resposta automática de áudio (${safety.source}, risco ${safety.severity}): ${safety.reason} Rascunho bloqueado: ${blockedDraft}`,
              outcome.result.transcription
            );
            console.warn(`🛡️ [Revisor pré-envio] tenant=${tenantId} bloqueou resposta de áudio para ${message.from}: ${safety.reason}`);
            emitAiReplyStatus(tenantId, message.from, 'failed');
            return;
          }
          // TASK-0297: quando o revisor corrige em vez de só aprovar/bloquear
          // (hoje só remove uma bolha isolada de empurrão de agenda depois de
          // pergunta informativa), envia a versão corrigida — nunca o
          // rascunho original nesse caso.
          const bubblesToSend = safety.correctedBubbles ?? result.bubbles;
          const calendarExecution = await executeApprovedCalendarActions(
            tenantId,
            message.from,
            undefined,
            result.deferredCalendarActions,
            message.contactName,
            message.messageId,
          );
          if (calendarExecution.hadError) {
            const reason = calendarExecution.summaries.join(' ');
            await logEscalation(tenantId, message.from, message.contactName, `Ação de agenda aprovada pelo revisor, mas não foi concluída antes do envio: ${reason}`, outcome.result.transcription);
            emitAiReplyStatus(tenantId, message.from, 'failed');
            return;
          }
          if (result.agent === 'reclamacao') {
            await logEscalation(tenantId, message.from, message.contactName, 'Cliente com reclamação — atendimento humano obrigatório, IA nunca resolve reclamação sozinha', outcome.result.transcription);
          } else if (result.agent === 'agendamento' && result.needsHumanConfirmation) {
            await logEscalation(tenantId, message.from, message.contactName, 'Cliente tentando fechar agendamento — confirmar disponibilidade real (ainda sem Google Calendar conectado)', outcome.result.transcription);
          }
          try {
            await sendBubbles(channel, message.from, bubblesToSend, async (bubbleText) => {
              await recordOutgoingMessage(tenantId, message.from, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
              console.log(`🤖 [Resposta Automática] tenant=${tenantId} Enviado pra ${message.from}: ${redactMessageForLog(bubbleText)} (agente: ${result.agent})`);
            }, message.messageId, result.phase, result.routerElapsedMs, result.quickReplyOptions);
          } catch (sendError: any) {
            let compensation = 'Não foi possível iniciar a compensação automática.';
            try {
              compensation = await compensateApprovedCalendarExecution(tenantId, message.from, calendarExecution);
            } catch (compensationError: any) {
              compensation = `A compensação automática falhou: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`;
            }
            await logEscalation(tenantId, message.from, message.contactName, `Falha ao enviar resposta após ação de agenda aprovada: ${sendError instanceof Error ? sendError.message : String(sendError)}. ${compensation}`, outcome.result.transcription);
            console.warn(`⚠️ [Agenda pós-envio] tenant=${tenantId} ${compensation}`);
            emitAiReplyStatus(tenantId, message.from, 'failed');
            return;
          }
          emitAiReplyStatus(tenantId, message.from, 'sent');
        } catch (err: any) {
          emitAiReplyStatus(tenantId, message.from, 'failed');
          if (isGeoRestrictedError(err)) {
            await markGeoRestricted(tenantId, message.from, err.message);
            await logEscalation(tenantId, message.from, message.contactName, 'Envio bloqueado por restrição geográfica — precisa de atendimento manual', outcome.result.transcription);
          } else {
            await logEscalation(tenantId, message.from, message.contactName, `Falha ao responder automaticamente: ${err.message}`, outcome.result.transcription);
          }
          console.warn('❌ [Resposta Automática] Falhou:', err.message);
        }
      });
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
