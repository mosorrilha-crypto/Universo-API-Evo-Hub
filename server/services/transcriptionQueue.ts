import type { GoogleGenAI } from '@google/genai';
import { transcribeAudioWithGemini, type TranscribeAudioOutcome } from './geminiTranscription';
import { downloadMetaMedia, downloadEvolutionMedia } from './mediaDownload';
import type { ParsedIncomingMessage } from './webhookParsers';

export interface TranscriptionJob {
  message: ParsedIncomingMessage;
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
  metaAccessToken?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
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

export function enqueueTranscriptionJob(message: ParsedIncomingMessage) {
  queue.push({ message, createdAt: new Date().toISOString() });
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
  const { message } = job;

  try {
    let audioBase64: string | undefined;
    let mimeType: string | undefined;

    if (message.type === 'audio' && message.metaAudio) {
      const downloaded = await downloadMetaMedia(message.metaAudio.mediaId, deps.metaAccessToken);
      audioBase64 = downloaded.base64;
      mimeType = downloaded.mimeType;
    } else if (message.type === 'audio' && message.evolutionAudio) {
      const downloaded = await downloadEvolutionMedia(
        { id: message.messageId, remoteJid: `${message.from}@s.whatsapp.net` },
        deps.evolutionInstanceName,
        deps.evolutionApiUrl,
        deps.evolutionApiKey
      );
      audioBase64 = downloaded.base64;
      mimeType = downloaded.mimeType;
    } else {
      throw new Error(`Mensagem tipo "${message.type}" não é áudio — nada a transcrever.`);
    }

    const outcome = await transcribeAudioWithGemini(deps.getAi(), audioBase64, mimeType, {
      leadName: message.contactName,
    });

    totalProcessed += 1;
    recordResult({ job, status: 'completed', outcome, finishedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt });
    console.log(`✅ [Fila de Transcrição] ${message.provider} ${message.messageId} concluído (source: ${outcome.source})`);
  } catch (err: any) {
    totalFailed += 1;
    recordResult({ job, status: 'failed', error: err.message, finishedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt });
    console.warn(`❌ [Fila de Transcrição] ${message.provider} ${message.messageId} falhou:`, err.message);
  }
}

function recordResult(result: TranscriptionJobResult) {
  recentResults.unshift(result);
  if (recentResults.length > MAX_RECENT_RESULTS) recentResults.length = MAX_RECENT_RESULTS;
}
