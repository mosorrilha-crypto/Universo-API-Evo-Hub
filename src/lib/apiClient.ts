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

// Tenant que o seletor do painel (Header.tsx) tem selecionado no momento —
// só tem efeito de verdade no backend pra saas_admin (ver resolveTenantId
// em server/middleware/rbac.ts); pra qualquer outro papel o backend ignora
// esse header e usa sempre o tenantId do próprio token, então não faz mal
// nenhum mandar mesmo sem checar o papel aqui no cliente.
//
// Achado real em produção (15/08/2026): até aqui esse seletor só mudava a
// TELA — toda chamada ao backend continuava resolvendo o tenant pelo token
// de login, fixo desde que o operador entrou. Um saas_admin trocou pra
// outro tenant no seletor, configurou algo lá (achando que estava editando
// aquele tenant) e a gravação foi silenciosamente pro tenant do PRÓPRIO
// login — um cliente real chegou a receber conteúdo de outro tenant.
// Achado real em produção (18/08/2026): diferente do token (linha 11
// acima), esse valor nunca era restaurado do localStorage no carregamento
// do módulo — só App.tsx o define, de forma assíncrona, depois que
// `currentUser`/`activeTenant` terminam de carregar. Qualquer `apiFetch`
// disparado antes disso (ou, com o bug de ordem de efeitos corrigido em
// App.tsx, mesmo já sincronizado corretamente) partia de `null`, caindo no
// tenant do próprio token do saas_admin em vez do tenant selecionado.
// Restaurar aqui, espelhando `readStoredToken()`, fecha essa janela.
const readStoredTenantOverride = (): string | null => {
  try {
    return localStorage.getItem('saas_active_tenant_override');
  } catch {
    return null;
  }
};

let tenantOverride: string | null = readStoredTenantOverride();

export const setTenantOverride = (tenantId: string | null) => {
  tenantOverride = tenantId;
};

export const getTenantOverride = () => tenantOverride;

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
  if (tenantOverride && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', tenantOverride);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 403 && currentToken) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  return response;
};
