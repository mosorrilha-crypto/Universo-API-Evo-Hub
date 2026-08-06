/**
 * Bloco 2.D.2 — RBAC (operator < manager < admin < saas_admin). Até aqui,
 * `authenticateToken` só verificava se o JWT era válido — qualquer papel
 * conseguia chamar qualquer rota autenticada, sem checar `role` nenhuma vez
 * no backend (confirmado por varredura: zero ocorrências de `req.user.role`
 * antes deste arquivo existir).
 */
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth';

export type Role = 'operator' | 'manager' | 'admin' | 'saas_admin';

const ROLE_RANK: Record<Role, number> = { operator: 0, manager: 1, admin: 2, saas_admin: 3 };

/** Bloqueia a rota pra quem tem papel abaixo de `minRole`. saas_admin sempre passa (é o topo da hierarquia). */
export function requireRole(minRole: Role) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role as Role | undefined;
    if (!role || !(role in ROLE_RANK) || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: 'Permissão insuficiente pra essa ação.' });
    }
    next();
  };
}

/** true se o operador autenticado é saas_admin (enxerga todos os tenants, não só o próprio). */
export function isSaasAdmin(req: AuthenticatedRequest): boolean {
  return req.user?.role === 'saas_admin';
}
