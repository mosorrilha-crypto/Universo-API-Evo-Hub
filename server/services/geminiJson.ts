/**
 * Gemini com `responseMimeType: 'application/json'` normalmente devolve JSON
 * válido, mas não é garantido — achado real (03/09/2026, avaliação
 * automática do agente, TASK-0225): um caso sintético quebrou com "Expected
 * double-quoted property name in JSON" porque a resposta veio malformada
 * (ex.: aspas de markdown ao redor, ou texto extra antes/depois do bloco
 * JSON). `JSON.parse` direto derruba a chamada inteira sem tentar
 * recuperar. Antes de desistir, tenta extrair o primeiro bloco `{...}`
 * balanceado do texto e reprocessar só ele — se ainda assim falhar, relança
 * o erro original (nunca mascara uma falha real com um objeto vazio
 * silencioso).
 */
export function safeParseGeminiJson(text: string | undefined | null): unknown {
  const raw = (text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (firstError) {
    const start = raw.indexOf('{');
    if (start === -1) throw firstError;
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          return JSON.parse(raw.slice(start, i + 1));
        }
      }
    }
    throw firstError;
  }
}
