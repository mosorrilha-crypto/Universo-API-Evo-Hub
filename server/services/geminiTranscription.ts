import type { GoogleGenAI } from '@google/genai';
import { withGeminiRetry } from '../gemini';

export interface TranscriptionResult {
  transcription: string;
  language: string;
  summary: string;
  intent: string;
  sentiment: string;
  keyPoints: string[];
  suggestedReply: string;
  urgencyScore: number;
}

export interface TranscribeAudioOutcome {
  source: 'gemini' | 'fallback';
  result: TranscriptionResult;
}

/**
 * Transcreve e analisa um áudio em base64 via Gemini, com fallback simulado
 * caso o Gemini não esteja configurado ou a chamada falhe. Compartilhado
 * entre a rota HTTP /api/transcribe e o worker da fila de webhooks (server/services/transcriptionQueue.ts),
 * pra não duplicar o prompt em dois lugares.
 */
export async function transcribeAudioWithGemini(
  ai: GoogleGenAI | null,
  audioBase64: string | undefined,
  mimeType: string | undefined,
  opts: { leadName?: string; customInstructions?: string } = {}
): Promise<TranscribeAudioOutcome> {
  if (ai && audioBase64) {
    try {
      const prompt = `Você é um transcritor e analista de áudios de atendimento para WhatsApp CRM.
Processe o áudio fornecido e responda estritamente em formato JSON com a seguinte estrutura:
{
  "transcription": "transcrição LITERAL do áudio, no MESMO idioma/dialeto em que a pessoa falou (nunca traduza — se falou em espanhol, transcreva em espanhol; se falou em português, em português)",
  "language": "idioma detectado no áudio (ex: 'Español (Paraguay)', 'Português (Brasil)')",
  "summary": "resumo de 1-2 frases do áudio, no mesmo idioma da transcrição",
  "intent": "Intenção do cliente",
  "sentiment": "Positivo" | "Neutro" | "Dúvida" | "Urgente" | "Objeção",
  "keyPoints": ["ponto chave 1", "ponto chave 2"],
  "suggestedReply": "sugestão de resposta amigável, no mesmo idioma da transcrição",
  "urgencyScore": número de 1 a 5
}
${opts.customInstructions || ''}`;

      const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');

      // Achado ao vivo: essa era a única chamada Gemini do projeto ainda sem
      // withGeminiRetry (autoReply.ts e as rotas de análise já tinham, ver
      // PR #103) — uma falha transitória (503/429/timeout) caía direto no
      // fallback "[Não foi possível transcrever o áudio no momento]" na
      // primeira tentativa, sem nenhuma segunda chance.
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: mimeType || 'audio/ogg',
              },
            },
            { text: prompt },
          ],
          config: {
            responseMimeType: 'application/json',
          },
        })
      );

      const rawText = response.text || '';
      const parsed = JSON.parse(rawText);
      return { source: 'gemini', result: parsed };
    } catch (geminiError) {
      console.warn('Gemini Audio Transcription error, fallbacking:', geminiError);
    }
  }

  // Sem fallback simulado com conteúdo inventado (mesmo princípio de
  // server/services/autoReply.ts: melhor admitir que não deu pra transcrever
  // do que gravar uma transcrição/sugestão fabricada no histórico real do
  // cliente — isso já foi um bug real (o fallback antigo era um texto fixo
  // sobre "plano comercial e suporte", herdado de um demo genérico, que não
  // tem nada a ver com o negócio de nenhum tenant real).
  const fallbackResult: TranscriptionResult = {
    transcription: '[Não foi possível transcrever o áudio no momento]',
    language: 'Desconhecido',
    summary: 'Falha ao transcrever — requer atenção humana.',
    intent: 'Desconhecido',
    sentiment: 'Neutro',
    keyPoints: [],
    suggestedReply: '',
    urgencyScore: 3,
  };

  return { source: 'fallback', result: fallbackResult };
}
