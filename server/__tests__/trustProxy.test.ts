/**
 * Achado real em produção: o Render (host) sempre manda X-Forwarded-For,
 * mas o Express nunca declarava confiar em proxy nenhum (padrão: false).
 *
 * Investigação inicial: o express-rate-limit loga um aviso
 * (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) quando detecta essa combinação — mas
 * ele CAPTURA esse erro internamente (só uma vez por processo) e não
 * derruba a requisição, então não é um 500 generalizado como pareceu à
 * primeira vista lendo o stack trace nos logs.
 *
 * O bug real é mais sutil: sem `trust proxy`, `req.ip` sempre resolve pro
 * IP do socket (o proxy do Render), NUNCA pro IP real do cliente vindo em
 * X-Forwarded-For. Isso faz o rate limit por IP (20 req/min) virar um
 * limite ÚNICO COMPARTILHADO por TODOS os usuários do app ao mesmo tempo,
 * em vez de 20/min por pessoa — qualquer operador ativo podia estourar o
 * limite pra todo mundo. Trava que `app.set('trust proxy', 1)` corrige
 * isso: cada X-Forwarded-For vira uma chave de rate limit separada.
 */
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';

let server: Server | undefined;

function startApp(trustProxy: boolean): Promise<string> {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  // Mesma forma da aiRateLimiter real (server/middleware/rateLimit.ts), só
  // com limit baixo pra tornar o teste rápido e determinístico.
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 1, standardHeaders: true, legacyHeaders: false });
  app.get('/api/analyze-conversation', limiter, (_req, res) => res.json({ success: true }));
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const address = server!.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe('trust proxy vs rate limiter por IP — X-Forwarded-For (achado real em produção)', () => {
  it('sem trust proxy, dois "IPs" diferentes (via X-Forwarded-For) dividem o MESMO limite — o 2º já vem bloqueado', async () => {
    const baseUrl = await startApp(false);
    const clienteA = await fetch(`${baseUrl}/api/analyze-conversation`, { headers: { 'X-Forwarded-For': '203.0.113.1' } });
    const clienteB = await fetch(`${baseUrl}/api/analyze-conversation`, { headers: { 'X-Forwarded-For': '203.0.113.2' } });
    expect(clienteA.status).toBe(200);
    // Bug: sem trust proxy, req.ip ignora X-Forwarded-For e usa sempre o IP
    // do socket (igual pros dois) — o cliente B consome o mesmo limite do A.
    expect(clienteB.status).toBe(429);
  });

  it('com trust proxy=1 (a correção), cada X-Forwarded-For tem seu próprio limite', async () => {
    const baseUrl = await startApp(true);
    const clienteA = await fetch(`${baseUrl}/api/analyze-conversation`, { headers: { 'X-Forwarded-For': '203.0.113.1' } });
    const clienteB = await fetch(`${baseUrl}/api/analyze-conversation`, { headers: { 'X-Forwarded-For': '203.0.113.2' } });
    expect(clienteA.status).toBe(200);
    expect(clienteB.status).toBe(200);
  });
});
