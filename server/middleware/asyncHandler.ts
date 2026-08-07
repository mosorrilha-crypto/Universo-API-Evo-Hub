import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 não espera (nem captura erro de) handlers async — se um handler
 * async lança ou rejeita sem try/catch próprio, vira um "unhandled
 * rejection" no processo inteiro (Node 22+ mata o processo por padrão),
 * derrubando o servidor pra TODOS os tenants, não só a requisição que
 * falhou. `process.on('unhandledRejection', ...)` em server.ts é a rede de
 * segurança de último caso; este wrapper é a correção de verdade — encaminha
 * o erro pro `next(err)` do Express, que cai no middleware de erro global
 * (também em server.ts) e devolve uma resposta HTTP decente em vez de
 * deixar a requisição travada sem resposta.
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
