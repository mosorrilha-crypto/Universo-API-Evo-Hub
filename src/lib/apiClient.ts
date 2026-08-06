const TOKEN_STORAGE_KEY = 'saas_auth_token';

const readStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

let currentToken: string | null = readStoredToken();

export const setAuthToken = (token: string | null) => {
  currentToken = token;
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage indisponível (ex: modo privado) — token só fica em memória.
  }
};

export const getAuthToken = () => currentToken;

// Callback disparado quando o servidor rejeita explicitamente o token da
// sessão (403 — token presente mas inválido/expirado, ver server/middleware/auth.ts:
// jwt.verify falhou). App.tsx registra isso pra forçar um novo login com
// aviso, em vez de deixar a tela travada com dados velhos e falhas
// silenciosas.
//
// Importante: NÃO reagir a 401 aqui. Nesse middleware, 401 significa "nenhum
// token foi enviado nesta chamada" (ex: uma chamada em segundo plano que
// disparou antes do login acontecer) — um evento normal e esperado, não um
// sinal de sessão quebrada. Tratar 401 como "sessão expirada" causava um
// logout forçado logo após um login válido, sempre que alguma chamada em
// segundo plano ainda sem token respondia (bug real observado: "entra e sai
// automático").
let onUnauthorized: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

/**
 * Wrapper de fetch que anexa `Authorization: Bearer <token>` automaticamente
 * quando há um token de sessão salvo. Use no lugar de `fetch` para chamar
 * rotas protegidas do backend (/api/transcribe, /api/analyze-conversation etc).
 */
export const apiFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers || {});
  if (currentToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 403 && currentToken) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  return response;
};
