/**
 * Achado real em produção (19/08/2026, tenant Monique): o Google às vezes
 * rotaciona o refresh_token numa renovação de access token (emite um
 * refresh_token NOVO junto do access_token, invalidando o antigo). Sem
 * persistir esse valor novo, toda chamada seguinte recriava o client OAuth
 * com o refresh_token antigo (já inválido) direto do banco — reconectar no
 * painel só resolvia por alguns minutos, até a primeira renovação rotacionar
 * o token de novo. Trava esse comportamento: getAuthorizedClient escuta o
 * evento `tokens` da lib googleapis e persiste um refresh_token rotacionado.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

const freebusyQuery = vi.fn();
const setCredentials = vi.fn();
let tokensListener: ((tokens: { refresh_token?: string; access_token?: string }) => void) | undefined;

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function OAuth2Mock(this: any) {
        this.setCredentials = setCredentials;
        this.on = (event: string, cb: typeof tokensListener) => {
          if (event === 'tokens') tokensListener = cb;
        };
      }),
    },
    calendar: vi.fn(() => ({ freebusy: { query: freebusyQuery } })),
  },
}));

const { checkFreeBusy } = await import('../googleCalendar');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

function seedDb(refreshToken: string) {
  const db = createFakeSupabase({
    tenants: [{ id: TENANT_A, business_hours: null }],
    tenant_calendar_tokens: [{ tenant_id: TENANT_A, refresh_token: refreshToken }],
  });
  initDb(db);
  return db;
}

beforeEach(() => {
  freebusyQuery.mockReset();
  setCredentials.mockReset();
  tokensListener = undefined;
  freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [] } } } });
});

describe('getAuthorizedClient — persistência de refresh_token rotacionado', () => {
  it('quando o Google emite um refresh_token novo, persiste no banco pro tenant', async () => {
    const db = seedDb('refresh-token-antigo');
    await checkFreeBusy(TENANT_A, CALENDAR_CONFIG, '2026-08-20T10:00:00', '2026-08-20T11:00:00');

    expect(tokensListener).toBeDefined();
    tokensListener!({ refresh_token: 'refresh-token-rotacionado', access_token: 'a' });
    // saveRefreshToken faz upsert async, sem await no listener — dá tempo do microtask rodar.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { data } = await db.from('tenant_calendar_tokens').select('refresh_token').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.refresh_token).toBe('refresh-token-rotacionado');
  });

  it('quando o Google NÃO emite um refresh_token novo (só renova o access_token), não sobrescreve o existente', async () => {
    const db = seedDb('refresh-token-estavel');
    await checkFreeBusy(TENANT_A, CALENDAR_CONFIG, '2026-08-20T10:00:00', '2026-08-20T11:00:00');

    tokensListener!({ access_token: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { data } = await db.from('tenant_calendar_tokens').select('refresh_token').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.refresh_token).toBe('refresh-token-estavel');
  });
});
