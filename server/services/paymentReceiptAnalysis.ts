/**
 * Analisa (via Gemini) uma imagem que possivelmente é um comprovante de
 * pagamento — só gera uma DICA curta pro operador decidir mais rápido no
 * painel, nunca confirma pagamento sozinho (mesma cautela de
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 4.3: só um humano confirma).
 * Custo controlado por propósito: só é chamado quando já existe um sinal
 * forte de que a imagem é mesmo um comprovante (webhooks.ts só chama isto
 * quando o contato já tem um agendamento ativo sem pagamento confirmado
 * ainda) — não roda em toda imagem recebida.
 */
import type { GoogleGenAI } from '@google/genai';
import { GEMINI_TIMEOUT_MS, withGeminiRetry } from '../gemini';

export interface ReceiptAnalysisResult {
  looksLikeReceipt: boolean;
  /** Frase curta com o que a IA conseguiu ler (valor, data, banco) — ou, se não parecer comprovante, uma frase curta dizendo o que a imagem parece ser. Nunca inventa dado que não deu pra ler. */
  hint: string;
}

/** Nunca lança — falha de análise não pode bloquear o fluxo real de marcar pending_verification (a dica é só um bônus). */
export async function analyzePaymentReceiptWithGemini(
  ai: GoogleGenAI | null,
  imageBase64: string,
  mimeType: string
): Promise<ReceiptAnalysisResult | null> {
  if (!ai || !imageBase64) return null;

  try {
    const prompt = `Você está ajudando um atendente humano a verificar mais rápido se uma imagem recebida de um cliente no WhatsApp é um comprovante de pagamento (transferência bancária, PIX, recibo). Você NUNCA confirma o pagamento — só resume o que consegue ler, pra o humano decidir com mais informação.

Responda ESTRITAMENTE em JSON:
{"looksLikeReceipt": true|false, "hint": "frase curta (máx ~15 palavras)"}

Se parecer um comprovante: descreva só o que está literalmente visível na imagem (valor, data, banco/app, nome se houver) — nunca invente um dado que não conseguir ler direito.
Se NÃO parecer um comprovante: diga em poucas palavras o que a imagem parece ser (ex: "foto de rosto/selfie", "print de outra conversa", "não deu pra identificar").`;

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: [
            { inlineData: { data: cleanBase64, mimeType: mimeType || 'image/jpeg' } },
            { text: prompt },
          ],
          config: { responseMimeType: 'application/json' },
        }),
      GEMINI_TIMEOUT_MS
    );

    const parsed = JSON.parse(response.text || '{}') as { looksLikeReceipt?: boolean; hint?: string };
    return {
      looksLikeReceipt: !!parsed.looksLikeReceipt,
      hint: typeof parsed.hint === 'string' ? parsed.hint.trim() : '',
    };
  } catch (err) {
    console.warn('⚠️  [Análise de comprovante] Falha na chamada ao Gemini (segue sem dica):', (err as Error).message);
    return null;
  }
}
