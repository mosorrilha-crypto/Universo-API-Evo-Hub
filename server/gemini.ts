import { GoogleGenAI } from '@google/genai';
import type { ServerConfig } from './config';

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(config: ServerConfig): GoogleGenAI | null {
  if (!config.geminiApiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export const GEMINI_TIMEOUT_MS = 20000;
const GEMINI_RETRY_BACKOFF_MS = [500, 1500];

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

/**
 * Achado real em produção (issue #82, item 4 / issue #94): falha transitória
 * do Gemini (timeout, 429, erro de rede) tinha zero tentativa extra em
 * autoReply.ts — virava silêncio total pro cliente na primeira falha.
 * Extraída pra cá (era local a autoReply.ts) porque o mesmo problema existia
 * em server/routes/ai.ts (/api/analyze-conversation, /api/analytics/ai-report)
 * sem NENHUMA proteção — confirmado nos logs do Render ("Gemini API call
 * error, fallbacking to preset analysis") caindo direto no fallback honesto
 * na 1ª falha, igual ao autoReply.ts tinha antes do #84.
 */
export async function withGeminiRetry<T>(makeCall: () => Promise<T>, timeoutMs: number = GEMINI_TIMEOUT_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= GEMINI_RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await withTimeout(makeCall(), timeoutMs);
    } catch (err) {
      lastErr = err;
      const backoffMs = GEMINI_RETRY_BACKOFF_MS[attempt];
      if (backoffMs === undefined) break;
      console.warn(`⚠️  Gemini falhou (tentativa ${attempt + 1}/${GEMINI_RETRY_BACKOFF_MS.length + 1}), tentando de novo em ${backoffMs}ms:`, (err as Error)?.message || err);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}
