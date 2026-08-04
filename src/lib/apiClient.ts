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

/**
 * Wrapper de fetch que anexa `Authorization: Bearer <token>` automaticamente
 * quando há um token de sessão salvo. Use no lugar de `fetch` para chamar
 * rotas protegidas do backend (/api/transcribe, /api/analyze-conversation etc).
 */
export const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers || {});
  if (currentToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  return fetch(input, { ...init, headers });
};
