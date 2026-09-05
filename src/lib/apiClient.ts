// TASK-0311 (TASK-0249 item 1, achado de segurança real): o JWT de sessão
// morava aqui — em `currentToken`/`localStorage`, texto puro, legível por
// qualquer JavaScript do cliente (um XSS ou extensão maliciosa lendo essa
// chave roubava a sessão inteira). Deixou de existir client-side: o backend
// agora entrega a sessão só via cookie `httpOnly` (`universo_session`, ver
// server/routes/auth.ts) — o navegador anexa sozinho em toda chamada
// same-origin (é o comportamento padrão do Fetch API, não precisa de
// `credentials: 'include'` aqui), e o JavaScript do frontend nunca tem
// acesso ao valor cru pra vazar.

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
// Achado real em produção (18/08/2026): esse valor nunca era restaurado do
// localStorage no carregamento do módulo — só App.tsx o define, de forma
// assíncrona, depois que `currentUser`/`activeTenant` terminam de carregar.
// Qualquer `apiFetch` disparado antes disso (ou, com o bug de ordem de
// efeitos corrigido em App.tsx, mesmo já sincronizado corretamente) partia
// de `null`, caindo no tenant do próprio token do saas_admin em vez do
// tenant selecionado. Restaurar aqui, no carregamento do módulo, fecha essa
// janela.
const readStoredTenantOverride = (): string | null => {
  try {
    return localStorage.getItem('saas_active_tenant_override');
  } catch {
    return null;
  }
};

// O backend persiste tenant_id como UUID. O cache antigo do frontend ainda
// pode conter IDs fictícios (ex: "tenant_004"); nunca envie esse valor no
// X-Tenant-Id, pois o PostgreSQL rejeita a consulta antes de ela chegar à rota.
// Aceitamos o formato UUID canônico completo sem restringir versão/variante:
// o tenant legado do Clic usa um UUID válido para o Postgres, mas criado com
// grupos que não seguem a variante RFC 4122 tradicional.
const TENANT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizeTenantOverride = (tenantId: string | null): string | null => {
  const normalized = tenantId?.trim();
  return normalized && TENANT_UUID_PATTERN.test(normalized) ? normalized : null;
};

let tenantOverride: string | null = normalizeTenantOverride(readStoredTenantOverride());

export const setTenantOverride = (tenantId: string | null) => {
  tenantOverride = normalizeTenantOverride(tenantId);
};

export const getTenantOverride = () => tenantOverride;

// Callback disparado somente quando o servidor marca explicitamente o token
// da sessão como inválido/expirado (ver server/middleware/auth.ts). App.tsx registra isso pra forçar um novo login com
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
 * Wrapper de fetch usado em toda chamada a rota protegida do backend
 * (/api/transcribe, /api/analyze-conversation etc). TASK-0311: não anexa
 * mais `Authorization` — a sessão viaja só pelo cookie `httpOnly`
 * `universo_session`, que o navegador já manda sozinho em toda requisição
 * same-origin (comportamento padrão do Fetch API).
 */
export const apiFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers || {});
  if (tenantOverride && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', tenantOverride);
  }
  const response = await fetch(input, { ...init, headers });
  // 403 também é a resposta normal de RBAC quando uma sessão válida não tem
  // papel suficiente. Só o middleware de autenticação marca sessão inválida
  // (header abaixo) — sem essa distinção, abrir uma área administrativa
  // fazia logout indevido. TASK-0311: sem `currentToken` client-side pra
  // saber se "achávamos" que havia sessão (o cookie é httpOnly, invisível
  // pro JS) — o sinal do servidor já basta sozinho.
  if (response.status === 403 && response.headers.get('X-Auth-Session-Invalid') === 'true') {
    onUnauthorized?.();
  }
  return response;
};
