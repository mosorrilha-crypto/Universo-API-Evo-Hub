import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../../config';
import { initDb } from '../../services/db';
import { createAuthenticateToken } from '../../middleware/auth';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const OWN = '11111111-1111-4111-8111-111111111111';
const SELECTED = '22222222-2222-4222-8222-222222222222';
const getMediaImage = vi.fn();
vi.mock('../../services/mediaImageStore', () => ({
  getMediaImage: (...args: any[]) => getMediaImage(...args), saveMediaImage: vi.fn(),
}));

// Modela a visibilidade RLS usando o tenant congelado no JWT emitido por getDb().
// Não basta filtrar só pelo .eq(): isso ocultaria a regressão de ordem de avaliação.
vi.mock('../../supabaseClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabaseClient')>();
  return {
    ...actual,
    createTenantScopedSupabaseClient: (config: ServerConfig, context: any) => {
      const token = actual.createTenantRuntimeAccessToken(config, context);
      const claims = jwt.verify(token, config.supabaseJwtSecret!) as jwt.JwtPayload;
      const rows = [
        { id: 'own-image', tenant_id: OWN },
        { id: 'selected-image', tenant_id: SELECTED },
      ].filter((row) => row.tenant_id === claims.tenant_id);
      return createFakeSupabase({ messages: rows });
    },
  };
});
const { createConversationsRouter } = await import('../conversations');

const config = {
  rlsEnforced: true, supabaseJwtSecret: 'runtime-test-secret',
} as ServerConfig;
const SESSION_SECRET = 'session-test-secret';
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(createConversationsRouter({
    authenticateToken: createAuthenticateToken(SESSION_SECRET), jwtSecret: SESSION_SECRET,
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(() => { server.close(); initDb(null); });
beforeEach(() => {
  initDb(createFakeSupabase({ messages: [] }), config);
  getMediaImage.mockReset().mockResolvedValue({ buffer: Buffer.from('webp-bytes'), contentType: 'image/webp' });
});

function headers(role = 'saas_admin', selected: string | null = SELECTED) {
  return {
    Cookie: `universo_session=${jwt.sign({ id: 'actor', tenantId: OWN, role }, SESSION_SECRET)}`,
    ...(selected ? { 'X-Tenant-Id': selected } : {}),
  };
}

describe('GET /api/media com sessão real e contexto RLS', () => {
  it('serve mídia da empresa selecionada pelo saas_admin com JWT de banco no tenant correto', async () => {
    const response = await fetch(`${baseUrl}/api/media/selected-image`, { headers: headers() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/webp');
    expect(await response.text()).toBe('webp-bytes');
    expect(getMediaImage).toHaveBeenCalledOnce();
  });

  it('não lê mídia da empresa original enquanto outra empresa está selecionada', async () => {
    const response = await fetch(`${baseUrl}/api/media/own-image`, { headers: headers() });
    expect(response.status).toBe(404);
    expect(getMediaImage).not.toHaveBeenCalled();
  });

  it('admin comum não consegue usar o header para ler mídia de outra empresa', async () => {
    const response = await fetch(`${baseUrl}/api/media/selected-image`, { headers: headers('admin') });
    expect(response.status).toBe(404);
    expect(getMediaImage).not.toHaveBeenCalled();
  });

  it('preserva acesso à própria mídia sem override e com override inválido', async () => {
    for (const selected of [null, 'tenant_invalido']) {
      const response = await fetch(`${baseUrl}/api/media/own-image`, { headers: headers('saas_admin', selected) });
      expect(response.status).toBe(200);
    }
  });

  it('recusa requisições sem sessão antes de consultar o armazenamento', async () => {
    const response = await fetch(`${baseUrl}/api/media/selected-image`);
    expect(response.status).toBe(401);
    expect(getMediaImage).not.toHaveBeenCalled();
  });
});
