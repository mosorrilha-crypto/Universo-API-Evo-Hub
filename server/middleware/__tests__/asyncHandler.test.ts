/**
 * Bug crítico de produção rastreado numa auditoria de código: Express 4 não
 * captura erro de handler async — sem asyncHandler, um erro em QUALQUER rota
 * vira um "unhandled rejection" e o Node 22+ mata o PROCESSO INTEIRO (não só
 * a requisição), derrubando o servidor pra todos os tenants. Reproduzido
 * localmente antes desta correção (POST /crash sem asyncHandler = processo
 * morre). Este teste trava que asyncHandler encaminha o erro pro next(err)
 * do Express em vez de deixar a rejeição escapar sem tratamento.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asyncHandler } from '../asyncHandler';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.get('/crash-sem-wrapper', async () => {
    throw new Error('boom sem asyncHandler — isso mataria o processo antes da correção');
  });
  app.get(
    '/crash-com-wrapper',
    asyncHandler(async () => {
      throw new Error('boom com asyncHandler — deve virar next(err), nunca derrubar o processo');
    })
  );
  app.get('/ok', (_req, res) => res.send('still alive'));
  // Middleware de erro global, igual ao de server.ts.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('asyncHandler', () => {
  it('rota com asyncHandler: erro vira resposta 500 normal, processo sobrevive', async () => {
    const res = await fetch(`${baseUrl}/crash-com-wrapper`);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('boom com asyncHandler');
  });

  it('depois de uma rota falhar, o servidor continua respondendo outras rotas normalmente', async () => {
    await fetch(`${baseUrl}/crash-com-wrapper`).catch(() => {});
    const res = await fetch(`${baseUrl}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('still alive');
  });
});
