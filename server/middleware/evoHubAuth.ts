import type { NextFunction, Request, Response } from 'express';

export type EvoHubRequest = Request & { evoAuth?: { token: string; authenticated: boolean } };

// Middleware Auth Evo Hub — as rotas /api/v1/* são um facade próprio (mock),
// não chamam a api.evohub.ai real. Exigem um token configurado em EVOHUB_API_KEY.
export function createAuthenticateEvoHub(evohubApiKey: string | undefined, isProduction: boolean) {
  return function authenticateEvoHub(req: EvoHubRequest, res: Response, next: NextFunction) {
    if (!evohubApiKey) {
      if (isProduction) {
        return res.status(503).json({ error: 'EVOHUB_API_KEY não configurada neste ambiente.' });
      }
      req.evoAuth = { token: 'dev_no_auth', authenticated: true };
      return next();
    }

    const authHeader = req.headers['authorization'] as string | undefined;
    const apiKeyQuery = req.query['api_key'] || req.query['key'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader || (apiKeyQuery as string | undefined);

    if (token !== evohubApiKey) {
      return res.status(401).json({ error: 'Token de autenticação do Evo Hub ausente ou inválido.' });
    }

    req.evoAuth = { token, authenticated: true };
    next();
  };
}
