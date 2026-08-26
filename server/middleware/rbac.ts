/**
 * Bloco 2.D.2 — RBAC (operator < manager < admin < saas_admin). Até aqui,
 * `authenticateToken` só verificava se o JWT era válido — qualquer papel
 * conseguia chamar qualquer rota autenticada, sem checar `role` nenhuma vez
 * no backend (confirmado por varredura: zero ocorrências de `req.user.role`
 * antes deste arquivo existir).
 */
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth';
import { replaceTenantInCurrentDbContext } from '../services/tenantDbContext';

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

/** Header que o seletor de tenant do painel (Header.tsx) manda pra apontar qual tenant um saas_admin está gerenciando no momento — ver resolveTenantId abaixo. */
export const TENANT_OVERRIDE_HEADER = 'x-tenant-id';
// O Postgres aceita UUIDs no formato canônico mesmo quando os grupos de
// versão/variante não seguem RFC 4122 (como o tenant legado do Clic). A
// validação garante o formato completo sem rejeitar esses IDs existentes.
const TENANT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve o tenant_id de verdade de uma requisição autenticada. Por padrão
 * vem sempre do JWT (`req.user.tenantId`) — nunca de body/query, pra nenhum
 * papel. A ÚNICA exceção: saas_admin pode apontar pra outro tenant mandando
 * o header `X-Tenant-Id` (é isso que o seletor de tenant do painel passa a
 * fazer de verdade a partir de agora).
 *
 * Achado real em produção (15/08/2026): até aqui esse seletor era
 * puramente cosmético — cada rota resolvia o tenant sempre pelo JWT, fixo
 * desde o login, então trocar o tenant na tela nunca mudava pra onde uma
 * gravação ia de verdade. Um saas_admin trocou pra "Clic Piscinas" no
 * seletor, configurou a Mensagem de Primeiro Contato lá, e ela foi salva
 * silenciosamente no tenant do PRÓPRIO login (Monique-Teste) — sem erro
 * nenhum. Um cliente real da Monique chegou a receber, como primeira
 * mensagem automática, o texto de entrega de piscina + lista de material
 * da Clic Piscinas.
 *
 * Pra qualquer papel que não seja saas_admin, o header é sempre ignorado —
 * um admin comum de tenant nunca consegue apontar pra outro tenant só
 * mandando esse header, mesmo que tente.
 */
export function resolveTenantId(req: AuthenticatedRequest): string {
  if (!req.user?.tenantId) {
    throw new Error('Sessão autenticada sem tenantId — recusado (nunca cair no tenant legado por segurança).');
  }
  if (isSaasAdmin(req)) {
    const override = req.headers[TENANT_OVERRIDE_HEADER];
    const value = Array.isArray(override) ? override[0] : override;
    const normalized = value?.trim();
    // O banco usa UUID em tenant_id. Overrides legados (ex: "tenant_004")
    // devem ser ignorados, nunca enviados ao Postgres; UUIDs canônicos antigos
    // continuam válidos mesmo sem versão/variante RFC 4122; o JWT continua
    // sendo a fonte segura de fallback para a requisição autenticada.
    if (normalized && TENANT_UUID_PATTERN.test(normalized)) {
      replaceTenantInCurrentDbContext(normalized);
      return normalized;
    }
  }
  return req.user.tenantId;
}
