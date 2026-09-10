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
import type { PaymentMethod } from './financialStore';

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

const VALID_PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'Transferência Bancária', 'Cartão de Crédito', 'Boleto Bancário', 'Link WhatsApp'];

export interface ReceiptExtractionResult {
  looksLikeReceipt: boolean;
  amount: number | null;
  currency: string | null;
  /** ISO yyyy-mm-dd quando dá pra ler, senão null. */
  date: string | null;
  /** Só um valor válido de PaymentMethod, ou null — nunca adivinhado/coagido. */
  method: PaymentMethod | null;
  bankOrApp: string | null;
  holderName: string | null;
  confidence: 'low' | 'medium' | 'high';
  hint: string;
}

/**
 * Igual a analyzePaymentReceiptWithGemini acima, mas tenta extrair campos
 * ESTRUTURADOS (valor, data, método) pra pré-preencher um formulário — usado
 * quando um operador marca manualmente uma imagem do chat como comprovante
 * (menu "⋮" do balão), não pelo fluxo automático de agendamento. Nunca
 * lança, nunca confirma nada sozinha: é só apoio pro operador revisar antes
 * de registrar o lançamento financeiro de verdade.
 */
export async function extractPaymentProofDataWithGemini(
  ai: GoogleGenAI | null,
  imageBase64: string,
  mimeType: string
): Promise<ReceiptExtractionResult | null> {
  if (!ai || !imageBase64) return null;

  try {
    const prompt = `Você está ajudando um atendente humano a preencher rapidamente um formulário de lançamento financeiro a partir de uma imagem enviada por um cliente no WhatsApp (possível comprovante de pagamento — transferência, PIX, recibo). Você NUNCA confirma o pagamento e NUNCA inventa um dado que não conseguir ler direito na imagem — quando não tiver certeza de um campo, devolva null nele.

Responda ESTRITAMENTE em JSON:
{"looksLikeReceipt": true|false, "amount": number|null, "currency": "BRL"|"PYG"|... |null, "date": "AAAA-MM-DD"|null, "method": "PIX"|"Transferência Bancária"|"Cartão de Crédito"|"Boleto Bancário"|"Link WhatsApp"|null, "bankOrApp": string|null, "holderName": string|null, "confidence": "low"|"medium"|"high", "hint": "frase curta (máx ~15 palavras)"}

Regras:
- "method" só pode ser um dos valores literais da lista acima, ou null se não der pra mapear com confiança.
- "amount" é só o número (sem símbolo de moeda), ou null.
- "date" só em formato ISO se estiver legível, senão null.
- Se NÃO parecer um comprovante, devolva looksLikeReceipt=false e preencha "hint" com o que a imagem parece ser; os demais campos ficam null.`;

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

    const parsed = JSON.parse(response.text || '{}') as Partial<ReceiptExtractionResult>;
    const method = typeof parsed.method === 'string' && VALID_PAYMENT_METHODS.includes(parsed.method as PaymentMethod) ? (parsed.method as PaymentMethod) : null;
    return {
      looksLikeReceipt: !!parsed.looksLikeReceipt,
      amount: typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : null,
      currency: typeof parsed.currency === 'string' && parsed.currency.trim() ? parsed.currency.trim() : null,
      date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(parsed.date) ? parsed.date : null,
      method,
      bankOrApp: typeof parsed.bankOrApp === 'string' && parsed.bankOrApp.trim() ? parsed.bankOrApp.trim() : null,
      holderName: typeof parsed.holderName === 'string' && parsed.holderName.trim() ? parsed.holderName.trim() : null,
      confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low',
      hint: typeof parsed.hint === 'string' ? parsed.hint.trim() : '',
    };
  } catch (err) {
    console.warn('⚠️  [Extração de comprovante] Falha na chamada ao Gemini (segue sem extração):', (err as Error).message);
    return null;
  }
}
