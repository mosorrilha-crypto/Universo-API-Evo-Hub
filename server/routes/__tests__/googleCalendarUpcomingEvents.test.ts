/**
 * GET /api/google-calendar/upcoming-events — widget de agenda no painel
 * (atendente via lista do que a IA/o operador já marcou, sem sair da
 * plataforma). Reusa listUpcomingEvents (já rodava em produção pro job de
 * lembretes) — esta rota só expõe isso, sem lógica nova de Google API.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const isGoogleCalendarConnected = vi.fn(async (_tenantId: string) => true);
const listUpcomingEvents = vi.fn(async (_tenantId: string, _cfg: unknown, _timeMinIso: string, _timeMaxIso: string) => [
  { id: 'evt-1', summary: 'Design de Sobrancelhas — Clarice', startIso: '2026-08-15T10:00:00-04:00' },
]);
const handleGoogleOAuthCallback = vi.fn();
const verifyOAuthState = vi.fn();

vi.mock('../../services/googleCalendar', () => ({
  isGoogleCalendarConnected,
  listUpcomingEvents,
  // Stubs — importados pelo router mas não exercitados por estes testes.
  getGoogleAuthUrl: vi.fn(),
  handleGoogleOAuthCallback,
  disconnectGoogleCalendar: vi.fn(),
  signOAuthState: vi.fn(),
  verifyOAuthState,
}));

const { createGoogleCalendarRouter } = await import('../googleCalendar');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ROUTER_DEPS = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  googleRedirectUri: 'https://x/oauth-callback',
  jwtSecret: 'test-secret',
};

let server: Server;
let baseUrl: string;
let authenticatedRole: 'operator' | 'manager' | 'admin' | 'saas_admin' = 'manager';

function fakeAuthenticateToken(tenantId: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId, role: authenticatedRole };
    next();
  };
}

function startServer(tenantId: string, deps: typeof ROUTER_DEPS = ROUTER_DEPS) {
  const app = express();
  app.use(express.json());
  app.use(createGoogleCalendarRouter({ authenticateToken: fakeAuthenticateToken(tenantId) as any, ...deps }));
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(() => {
  authenticatedRole = 'manager';
  initDb(createFakeSupabase());
});

afterEach(async () => {
  vi.clearAllMocks();
  isGoogleCalendarConnected.mockResolvedValue(true);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/google-calendar/oauth-callback', () => {
  it('rejeita state ausente ou inválido sem associar um refresh token a tenant algum', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/oauth-callback?code=authorization-code`);

    expect(res.status).toBe(400);
    expect(handleGoogleOAuthCallback).not.toHaveBeenCalled();
  });

  it('conclui a conexão somente quando o state assinado identifica o tenant', async () => {
    verifyOAuthState.mockReturnValue(TENANT_A);
    handleGoogleOAuthCallback.mockResolvedValue(undefined);
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/oauth-callback?code=authorization-code&state=state-assinado`);

    expect(res.status).toBe(200);
    expect(handleGoogleOAuthCallback).toHaveBeenCalledWith(TENANT_A, 'authorization-code', 'client-id', 'client-secret', 'https://x/oauth-callback');
  });
});

describe('GET /api/google-calendar/upcoming-events', () => {
  it('retorna os eventos reais quando o tenant está conectado', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ id: 'evt-1', summary: 'Design de Sobrancelhas — Clarice', completed: false });
    expect(isGoogleCalendarConnected).toHaveBeenCalledWith(TENANT_A);
    expect(listUpcomingEvents).toHaveBeenCalledWith(TENANT_A, expect.anything(), expect.any(String), expect.any(String));
  });

  it('503 quando o tenant não está conectado ao Google Calendar', async () => {
    isGoogleCalendarConnected.mockResolvedValue(false);
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect(res.status).toBe(503);
    expect(listUpcomingEvents).not.toHaveBeenCalled();
  });

  it('usa o "days" da query pra calcular a janela de datas', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    await fetch(`${baseUrl}/api/google-calendar/upcoming-events?days=7`);
    const [, , timeMinIso, timeMaxIso] = listUpcomingEvents.mock.calls[0];
    const diffDays = (Date.parse(timeMaxIso) - Date.parse(timeMinIso)) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 1);
  });

  it('isolamento entre tenants — cada request checa/busca só o próprio tenant', async () => {
    ({ server, baseUrl } = await startServer(TENANT_B));

    await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect(isGoogleCalendarConnected).toHaveBeenCalledWith(TENANT_B);
    expect(listUpcomingEvents).toHaveBeenCalledWith(TENANT_B, expect.anything(), expect.any(String), expect.any(String));
  });

  it('?year&month troca a janela pro mês inteiro (não os "próximos dias" a partir de agora)', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    await fetch(`${baseUrl}/api/google-calendar/upcoming-events?year=2026&month=2`);
    const [, , timeMinIso, timeMaxIso] = listUpcomingEvents.mock.calls[0];
    expect(new Date(timeMinIso).getMonth()).toBe(1); // fevereiro = índice 1
    expect(new Date(timeMinIso).getDate()).toBe(1);
    expect(new Date(timeMaxIso).getMonth()).toBe(2); // início de março (exclusivo)
  });

  it('devolve completed:true pros eventos já marcados como concluídos', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));
    await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });

    const res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    const data = await res.json();
    expect(data.events[0]).toMatchObject({ id: 'evt-1', completed: true });
  });
});

describe('POST /api/google-calendar/events/:eventId/complete', () => {
  it('marca e desmarca um evento como concluído', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    const markRes = await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    expect(markRes.status).toBe(200);

    let res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect((await res.json()).events[0].completed).toBe(true);

    const unmarkRes = await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: false }),
    });
    expect(unmarkRes.status).toBe(200);

    res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect((await res.json()).events[0].completed).toBe(false);
  });

  it('400 quando "completed" não é boolean', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));
    const res = await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: 'sim' }),
    });
    expect(res.status).toBe(400);
  });

  it('recusa alteração por operador, mesmo quando a rota é chamada diretamente', async () => {
    authenticatedRole = 'operator';
    ({ server, baseUrl } = await startServer(TENANT_A));
    const res = await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    expect(res.status).toBe(403);
  });

  it('isolado por tenant — marcar concluído no tenant A não vaza pro tenant B', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));
    await fetch(`${baseUrl}/api/google-calendar/events/evt-1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    ({ server, baseUrl } = await startServer(TENANT_B));
    const res = await fetch(`${baseUrl}/api/google-calendar/upcoming-events`);
    expect((await res.json()).events[0].completed).toBe(false);
  });
});
