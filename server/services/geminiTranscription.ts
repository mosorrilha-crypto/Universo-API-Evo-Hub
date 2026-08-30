import type { GoogleGenAI } from '@google/genai';
import { withGeminiRetry } from '../gemini';
import { isAudioEffectivelySilent } from './audioTranscode';

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
 *
 * Achado real de auditoria (29/08/2026): um áudio enviado deliberadamente
 * sem nenhuma fala (silêncio) voltou do Gemini com `source: 'gemini'`
 * (chamada teve sucesso técnico) e uma transcrição completa e plausível de
 * uma cliente perguntando preço/disponibilidade — 100% inventada, já que
 * não havia fala nenhuma no áudio. Isso alimentou `generateAutoReplyForText`
 * como se fosse a mensagem real da cliente (ver transcriptionQueue.ts), e
 * só não chegou a enviar porque o revisor pré-envio bloqueou o rascunho
 * gerado em cima dela. O guard de "sem fallback inventado" logo abaixo só
 * cobre o caminho de FALHA da chamada (erro de rede/timeout) — nunca
 * cobria o caso do Gemini "ter sucesso" alucinando conteúdo pra preencher
 * um JSON obrigatório sem fala real por trás. Corrigido com regra explícita
 * no prompt (retornar `transcription: ""` sem fala real) + gate em
 * transcriptionQueue.ts que nunca dispara resposta automática nem some a
 * mensagem — escala pra humano do mesmo jeito que uma falha técnica.
 *
 * Achado real seguinte (mesmo dia, áudio de 2s gravado pelo operador sem
 * nenhuma fala): a regra de prompt acima sozinha NÃO bastou — o Gemini
 * continuou inventando uma transcrição plausível mesmo com a instrução
 * explícita. Instrução de prompt nunca é garantia (mesmo princípio de todo
 * outro gate anti-alucinação deste projeto) — adicionado `isAudioEffectivelySilent`
 * (audioTranscode.ts, mede silêncio real via ffmpeg) como barreira
 * determinística ANTES de mandar qualquer áudio pro Gemini: se for
 * silêncio de verdade, nem chama o modelo, fechando essa via de alucinação
 * na raiz em vez de só pedir educadamente pra ele não inventar.
 */
function noSpeechDetectedResult(): TranscriptionResult {
  return {
    transcription: '',
    language: 'Desconhecido',
    summary: 'Áudio sem fala inteligível detectada.',
    intent: 'Desconhecido',
    sentiment: 'Neutro',
    keyPoints: [],
    suggestedReply: '',
    urgencyScore: 1,
  };
}

export async function transcribeAudioWithGemini(
  ai: GoogleGenAI | null,
  audioBase64: string | undefined,
  mimeType: string | undefined,
  opts: { leadName?: string; customInstructions?: string } = {}
): Promise<TranscribeAudioOutcome> {
  if (ai && audioBase64) {
    if (await isAudioEffectivelySilent(audioBase64, mimeType)) {
      return { source: 'gemini', result: noSpeechDetectedResult() };
    }
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

REGRA CRÍTICA: se o áudio estiver em silêncio, só tiver ruído de fundo, música, ou qualquer trecho de fala for curto/abafado demais pra captar conteúdo real e específico, responda com "transcription": "" (string vazia) — nunca invente uma fala plausível que a pessoa não disse, mesmo que o áudio tenha duração normal (duração não é garantia de fala real dentro dele). Nesse caso preencha também "summary": "Áudio sem fala inteligível detectada.", "intent": "Desconhecido", "sentiment": "Neutro", "keyPoints": [], "suggestedReply": "", "urgencyScore": 1 — nunca alucine intenção, sentimento ou sugestão de resposta a partir de um áudio sem fala real.
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
