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
// TASK-0353 (achado real em produção, mesmo dia do deploy da TASK-0346):
// llama-3.3-70b-versatile responde 404 "model_not_found" nesta conta Groq
// — confirmado via console.groq.com/docs/models que Llama 3.1 8B e Llama
// 3.3 70B são "Enterprise-only" (contact sales) na Groq, não disponíveis
// num plano padrão/developer, ao contrário do que a doc geral sugeria ao
// simplesmente listar o modelo como "produção". Isso quebrou AO VIVO as
// três tarefas que passaram a depender de GROQ_SPECIALIST_MODEL no mesmo
// dia (resposta do especialista, Ficha IA, análise de transcrição de
// áudio) — todas caindo pro Gemini, que também estava sem crédito
// (incidente duplo). openai/gpt-oss-120b é o modelo mais forte
// CONFIRMADAMENTE disponível no plano developer/pay-as-you-go (mesma
// família do openai/gpt-oss-20b já usado no roteador, só maior — 120B
// parâmetros, mesma janela de contexto 131072, ainda mais barato que
// Llama 70B seria).
export const GROQ_SPECIALIST_MODEL = 'openai/gpt-oss-120b';
/**
 * Timeout maior que o do roteador (GROQ_TIMEOUT_MS, 6s) — a resposta do
 * especialista é texto de atendimento de verdade (1-2 bolhas + campos de
 * acompanhamento de funil), não só um enum curto como a classificação do
 * roteador, e um modelo maior tem mais raciocínio pra fazer antes de
 * responder.
 */
export const GROQ_SPECIALIST_TIMEOUT_MS = 12000;

/**
 * Timeout curto e sem retry — decisão explícita do plano aprovado: Groq
 * ganha só 1 tentativa antes de cair pro Gemini (que já tem seu próprio
 * retry/timeout de 20s). Um timeout longo aqui destruiria o benefício de
 * latência de ter Groq como primeira opção.
 */
export const GROQ_TIMEOUT_MS = 6000;

// TASK-0352 (pedido direto, mesmo incidente ativo — Gemini sem crédito):
// transcrição de áudio via Groq/Whisper como primeira tentativa, mesmo
// padrão Groq-primeiro-Gemini-de-fallback já usado no resto do arquivo —
// large-v3 (não a variante "turbo") pela mesma lógica de sempre preferir o
// modelo mais forte disponível quando a alternativa de fallback (Gemini)
// está indisponível: sem crédito, não há segunda chance de qualidade nesta
// mensagem específica.
export const GROQ_WHISPER_MODEL = 'whisper-large-v3';
export const GROQ_WHISPER_TIMEOUT_MS = 15000;
const GROQ_AUDIO_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export interface GroqUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GroqTranscriptionResult {
  /** Transcrição literal — string vazia é um resultado válido (silêncio real), nunca tratado como falha por este módulo. */
  text: string;
  /** Idioma detectado pelo Whisper (ISO-639-1, ex: "es", "pt") quando o Groq devolve — ausente se não vier no corpo da resposta. */
  language?: string;
}

/** Extensão de arquivo aceita pelo Whisper mais próxima do mimeType recebido — o nome do arquivo no multipart não precisa ser exato, só plausível o bastante pro Groq inferir o codec quando o mimeType em si já não é claro o bastante. */
function guessAudioFileExtension(mimeType?: string): string {
  const type = (mimeType || '').toLowerCase();
  if (type.includes('mp3') || type.includes('mpeg')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('wav')) return 'wav';
  if (type.includes('webm')) return 'webm';
  return 'ogg';
}

/**
 * Chama o Groq/Whisper pra transcrever um áudio já decodificado (Buffer cru,
 * sem prefixo de Data URL — quem chama já limpou isso). Lança em qualquer
 * falha — rede, timeout, HTTP não-2xx, corpo sem campo "text". Uma
 * transcrição vazia (silêncio real) NÃO é uma falha — é responsabilidade do
 * chamador decidir o que fazer com `text: ""` (mesmo contrato já usado pro
 * Gemini em geminiTranscription.ts).
 */
export async function callGroqAudioTranscription(
  apiKey: string,
  audioBuffer: Buffer,
  mimeType: string | undefined,
  timeoutMs: number = GROQ_WHISPER_TIMEOUT_MS
): Promise<GroqTranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    const fileName = `audio.${guessAudioFileExtension(mimeType)}`;
    form.set('file', new Blob([audioBuffer], { type: mimeType || 'audio/ogg' }), fileName);
    form.set('model', GROQ_WHISPER_MODEL);
    form.set('response_format', 'verbose_json');

    const res = await fetch(GROQ_AUDIO_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Groq (Whisper) respondeu ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data: any = await res.json();
    if (typeof data?.text !== 'string') {
      throw new Error('Groq (Whisper) não retornou o campo "text" esperado.');
    }

    return { text: data.text, language: typeof data.language === 'string' ? data.language : undefined };
  } finally {
    clearTimeout(timer);
  }
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
 *
 * `model`/`temperature` opcionais (TASK-0346) — o roteador continua usando
 * o default (`GROQ_MODEL`, temperatura 0, determinístico: só classifica um
 * enum). A geração da resposta do especialista passa `GROQ_SPECIALIST_MODEL`
 * e uma temperatura > 0 (texto criativo de atendimento, não classificação).
 */
export async function callGroqJsonCompletion(
  apiKey: string,
  prompt: string,
  timeoutMs: number = GROQ_TIMEOUT_MS,
  model: string = GROQ_MODEL,
  temperature: number = 0
): Promise<GroqJsonCompletionResult> {
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
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature,
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
