/**
 * Gemini com `responseMimeType: 'application/json'` normalmente devolve JSON
 * válido, mas não é garantido. `JSON.parse` direto derruba a chamada inteira
 * sem tentar recuperar. Antes de desistir, tenta em camadas:
 * 1. Parse direto.
 * 2. Extrai o primeiro bloco `{...}` balanceado do texto (recupera de
 *    markdown/texto extra ao redor do JSON).
 * 3. Nesse bloco, tenta "consertar" chave de objeto sem aspas
 *    (`{issues: [...]}` → `{"issues": [...]}`) — achado real (03/09/2026,
 *    TASK-0227 e sua continuação): a etapa 2 sozinha não bastou, 2 de 10
 *    casos da rodada seguinte continuaram quebrando com a MESMA mensagem
 *    ("Expected double-quoted property name in JSON") na MESMA posição,
 *    provando que o problema é sintaxe interna do objeto (chave sem aspas),
 *    não só ruído ao redor do bloco JSON.
 *
 * 4. Ainda no bloco, tenta consertar o caso em que o Gemini omite por
 *    completo o nome da chave antes de um valor de array — não uma chave
 *    sem aspas (camada 3), a chave inteira falta, ficando
 *    `{"passed":false,["problema"],"suggestedFix":"..."}` em vez de
 *    `{"passed":false,"issues":["problema"],"suggestedFix":"..."}`.
 *    Achado real (03/09/2026, TASK-0236): esse exato padrão apareceu 3x
 *    numa única rodada de avaliação, sempre com a mesma mensagem "Expected
 *    double-quoted property name in JSON" — uma vírgula seguida direto de
 *    `[` só pode ocorrer, dentro de um objeto JSON, quando falta o par
 *    `"issues":` antes do array (nunca é JSON válido de outra forma), então
 *    a reinserção é seguro o bastante para tentar antes de desistir.
 *
 * Se nenhuma camada produzir JSON válido, relança o erro original — nunca
 * mascara uma falha real com um objeto vazio silencioso — mas anexa um
 * trecho do texto bruto que falhou à mensagem. Achado real (03/09/2026):
 * mesmo depois da 3ª camada de recuperação, 2 de 15 casos numa rodada
 * seguinte ainda quebraram com a MESMA mensagem de erro — sem o texto
 * bruto nunca fica registrado em lugar nenhum (nem no banco, nem no log),
 * então não dá pra diagnosticar QUAL malformação nova é essa. Isso resolve
 * a falta de evidência pra próxima vez, mesmo sem resolver a causa ainda
 * desconhecida.
 */
export function safeParseGeminiJson(text: string | undefined | null): unknown {
  const raw = (text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (firstError) {
    const start = raw.indexOf('{');
    if (start === -1) throw withRawTextSnippet(firstError, raw);
    let candidate: string | null = null;
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          candidate = raw.slice(start, i + 1);
          break;
        }
      }
    }
    if (candidate === null) throw withRawTextSnippet(firstError, raw);
    try {
      return JSON.parse(candidate);
    } catch {
      const repaired = candidate.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
      try {
        return JSON.parse(repaired);
      } catch {
        const withIssuesKey = repaired.replace(/,\s*\[/, ',"issues":[');
        try {
          return JSON.parse(withIssuesKey);
        } catch {
          throw withRawTextSnippet(firstError, raw);
        }
      }
    }
  }
}

const RAW_TEXT_SNIPPET_LENGTH = 300;

function withRawTextSnippet(error: unknown, raw: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const snippet = raw.length > RAW_TEXT_SNIPPET_LENGTH ? `${raw.slice(0, RAW_TEXT_SNIPPET_LENGTH)}… [truncado]` : raw;
  return new Error(`${message} — texto bruto recebido: ${JSON.stringify(snippet)}`);
}
