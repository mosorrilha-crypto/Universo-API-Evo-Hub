import type { GoogleGenAI } from '@google/genai';
import { transcribeAudioWithGemini, type TranscribeAudioOutcome } from './geminiTranscription';
import { downloadMetaMedia, downloadEvolutionMedia } from './mediaDownload';
import { updateMessageText, recordOutgoingMessage, getConversation, markGeoRestricted, shouldBlockForAdsOnlyMode } from './conversationStore';
import { saveMediaImage } from './mediaImageStore';
import { sendBubbles, type OutboundChannel } from './sendBubbles';
import { isGeoRestrictedError } from './metaSend';
import { generateAutoReplyForText } from './autoReply';
import { isAgentPaused } from './agentStatus';
import { runExclusive } from './perPhoneQueue';
import { getKnowledgeBase, formatKnowledgeBaseForPrompt } from './knowledgeBaseStore';
import { getTenantSegment } from './tenantProfileStore';
import { logEscalation, isPaymentRelated, looksLikeHarassment } from './escalationStore';
import { redactMessageForLog } from './logRedaction';
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

async function processJob(job: TranscriptionJob, deps: TranscriptionQueueDeps) {
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
      customInstructions: formatKnowledgeBaseForPrompt(await getKnowledgeBase(tenantId)),
    });

    totalProcessed += 1;
    recordResult({ job, status: 'completed', outcome, finishedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt });
    await updateMessageText(tenantId, message.from, message.messageId, outcome.result.transcription);
    console.log(`✅ [Fila de Transcrição] tenant=${tenantId} ${message.provider} ${message.messageId} concluído (source: ${outcome.source}): ${redactMessageForLog(outcome.result.transcription)}`);

    if (outcome.source === 'fallback') {
      await logEscalation(tenantId, message.from, message.contactName, 'Falha ao transcrever áudio automaticamente — operador precisa ouvir manualmente', outcome.result.transcription);
    } else if (isPaymentRelated(outcome.result.transcription)) {
      await logEscalation(tenantId, message.from, message.contactName, 'Áudio sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana', outcome.result.transcription);
    } else if (looksLikeHarassment(outcome.result.transcription)) {
      await logEscalation(tenantId, message.from, message.contactName, '🚫 Áudio de conteúdo pessoal/romântico dirigido à assistente — possível assédio, considere bloquear a IA pra este contato (menu ⋮ na conversa)', outcome.result.transcription);
    }

    // Resposta automática (Epic 1.3): só quando a análise veio do Gemini de
    // verdade (não do fallback simulado), pra não responder algo genérico.
    // Reaproveita o mesmo motor de bolhas/humanização do caminho de texto
    // (generateAutoReplyForText), passando a transcrição como se fosse a
    // mensagem recebida — evita duplicar a lógica de estilo em dois lugares.
    if (outcome.source === 'gemini' && !(await isAgentPaused(tenantId))) {
      runExclusive(message.from, async () => {
        const conversation = await getConversation(tenantId, message.from);
        // Mesmo bloqueio por lead individual do caminho de texto (ver
        // webhooks.ts triggerAutoReply) — um lead bloqueado não deve
        // receber resposta automática nem quando manda áudio.
        if (conversation?.aiBlockedAt) return;
        // Mesmo gate do caminho de texto (ver webhooks.ts triggerAutoReply) —
        // modo "somente anúncios" também vale pra áudio, usando a
        // transcrição como o texto a comparar com os gatilhos configurados.
        if (await shouldBlockForAdsOnlyMode(tenantId, message.from, outcome.result.transcription)) return;
        const kbContext = formatKnowledgeBaseForPrompt(await getKnowledgeBase(tenantId));
        const segment = await getTenantSegment(tenantId);
        const history = conversation?.messages.slice(0, -1);
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
            return;
          }
          if (result.agent === 'reclamacao') {
            await logEscalation(tenantId, message.from, message.contactName, 'Cliente com reclamação — atendimento humano obrigatório, IA nunca resolve reclamação sozinha', outcome.result.transcription);
          } else if (result.agent === 'agendamento' && result.needsHumanConfirmation) {
            await logEscalation(tenantId, message.from, message.contactName, 'Cliente tentando fechar agendamento — confirmar disponibilidade real (ainda sem Google Calendar conectado)', outcome.result.transcription);
          }
          await sendBubbles(channel, message.from, result.bubbles, async (bubbleText) => {
            await recordOutgoingMessage(tenantId, message.from, { type: 'text', text: bubbleText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }, 'ai');
            console.log(`🤖 [Resposta Automática] tenant=${tenantId} Enviado pra ${message.from}: ${redactMessageForLog(bubbleText)} (agente: ${result.agent})`);
          }, message.messageId, result.phase, result.routerElapsedMs);
        } catch (err: any) {
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
