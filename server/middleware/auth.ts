import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenantDbContext } from '../services/tenantDbContext';

/**
 * `express-serve-static-core`'s `ParamsDictionary` types every param as
 * `string | string[]` to support Express 5's repeated-segment routes (e.g.
 * `/:name+`, `*splat`) — none of which this codebase declares. Every route
 * here uses plain single-value params, so `req.params.x` is always a real
 * `string` at runtime; this narrows the type back instead of casting at each
 * of the ~50 call sites across the route files.
 */
interface StringParamsDictionary {
  [key: string]: string;
}

export type AuthenticatedRequest = Request<StringParamsDictionary> & { user?: any };

export function createAuthenticateToken(jwtSecret: string) {
  return function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // TASK-0311 (TASK-0249 item 1): token deixou de vir por header
    // `Authorization` (legível por qualquer JS do cliente, inclusive um XSS)
    // e passou a vir só pelo cookie httpOnly `universo_session` (setado em
    // auth.ts) — o navegador anexa sozinho, o JavaScript do frontend nunca
    // tem acesso ao valor cru.
    const token = req.cookies?.universo_session;
    if (!token) return res.sendStatus(401);

    jwt.verify(token, jwtSecret, (err: any, user: any) => {
      if (err) return res.status(403).set('X-Auth-Session-Invalid', 'true').json({ error: 'Sessão expirada ou inválida.' });
      if (!user?.tenantId) {
        return res.status(403).set('X-Auth-Session-Invalid', 'true').json({ error: 'Sessão autenticada sem tenant. Acesso recusado.' });
      }

      req.user = user;
      return runWithTenantDbContext(
        {
          tenantId: user.tenantId,
          actorId: user.id,
          role: user.role,
          source: 'authenticated_request',
        },
        () => next()
      );
    });
  };
}
