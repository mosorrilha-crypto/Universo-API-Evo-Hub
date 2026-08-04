import type { GoogleGenAI } from '@google/genai';

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
  "transcription": "transcrição do áudio em português",
  "language": "Português (Brasil)",
  "summary": "resumo de 1-2 frases do áudio",
  "intent": "Intenção do cliente",
  "sentiment": "Positivo" | "Neutro" | "Dúvida" | "Urgente" | "Objeção",
  "keyPoints": ["ponto chave 1", "ponto chave 2"],
  "suggestedReply": "sugestão de resposta amigável",
  "urgencyScore": número de 1 a 5
}
${opts.customInstructions || ''}`;

      const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');

      const response = await ai.models.generateContent({
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
      });

      const rawText = response.text || '';
      const parsed = JSON.parse(rawText);
      return { source: 'gemini', result: parsed };
    } catch (geminiError) {
      console.warn('Gemini Audio Transcription error, fallbacking:', geminiError);
    }
  }

  const fallbackResult: TranscriptionResult = {
    transcription: 'Olá, gostaria de confirmar os detalhes do plano comercial e saber se há suporte para dúvidas de integração.',
    language: 'Português (Brasil)',
    summary: 'Cliente solicita confirmação de suporte e detalhes sobre o plano comercial.',
    intent: 'Dúvida Comercial & Suporte',
    sentiment: 'Positivo',
    keyPoints: ['Suporte técnico', 'Plano comercial'],
    suggestedReply: `Olá ${opts.leadName || ''}! Nosso plano inclui suporte dedicado 24/7 e onboarding acompanhado. Como posso ajudar com seu início?`,
    urgencyScore: 4,
  };

  return { source: 'fallback', result: fallbackResult };
}
