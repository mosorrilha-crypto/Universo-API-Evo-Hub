import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

export type AuthenticatedRequest = Request & { user?: any };

export function createAuthenticateToken(jwtSecret: string) {
  return function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, jwtSecret, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };
}
