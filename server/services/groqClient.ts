/**
 * Cliente REST mínimo pro Groq (API compatível com OpenAI) — usado só como
 * primeira tentativa, mais barata e rápida, na classificação do router
 * (classifyAgent em autoReply.ts). Sem SDK pesado: uma única chamada POST.
 * Qualquer falha (rede, timeout, HTTP não-2xx, JSON malformado, campo
 * "agent" ausente) deve ser tratada pelo chamador como "cai pro Gemini" —
 * este módulo só lança o erro, nunca decide o fallback sozinho.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Achado real em produção (18/08/2026): llama-3.1-8b-instant foi
// descontinuado pela Groq em 16/08/2026 — toda chamada passou a responder
// 404 "model_not_found" (100% de fallback silencioso pro Gemini, sem
// nenhum aviso visível, já que o router trata qualquer falha do Groq como
// "cai pro Gemini" por design). Substituto oficial recomendado pela própria
// Groq na doc de depreciação (console.groq.com/docs/deprecations):
// openai/gpt-oss-20b.
const GROQ_MODEL = 'openai/gpt-oss-20b';

/**
 * Timeout curto e sem retry — decisão explícita do plano aprovado: Groq
 * ganha só 1 tentativa antes de cair pro Gemini (que já tem seu próprio
 * retry/timeout de 20s). Um timeout longo aqui destruiria o benefício de
 * latência de ter Groq como primeira opção.
 */
export const GROQ_TIMEOUT_MS = 6000;

export interface GroqUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GroqJsonCompletionResult {
  /** Conteúdo já parseado como JSON — o chamador valida os campos esperados. */
  parsed: any;
  usage?: GroqUsage;
}

/**
 * Chama o Groq pedindo resposta em JSON puro (response_format json_object,
 * mesmo padrão do responseMimeType 'application/json' já usado com o
 * Gemini). Lança em qualquer falha — rede, timeout, HTTP não-2xx, corpo sem
 * "choices[0].message.content", ou content que não é um JSON válido.
 */
export async function callGroqJsonCompletion(apiKey: string, prompt: string, timeoutMs: number = GROQ_TIMEOUT_MS): Promise<GroqJsonCompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Groq respondeu ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Groq não retornou conteúdo em choices[0].message.content.');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Groq retornou um conteúdo que não é JSON válido.');
    }

    const usage: GroqUsage | undefined = data?.usage
      ? {
          promptTokenCount: data.usage.prompt_tokens,
          candidatesTokenCount: data.usage.completion_tokens,
          totalTokenCount: data.usage.total_tokens,
        }
      : undefined;

    return { parsed, usage };
  } finally {
    clearTimeout(timer);
  }
}
