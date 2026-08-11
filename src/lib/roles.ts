import type { UserRole } from '../types';

/**
 * Hierarquia de papéis (mesma ordem do backend — ver server/middleware/rbac.ts,
 * `ROLE_RANK`): operator < manager < admin < saas_admin. Mantida separada
 * aqui porque o frontend não importa nada de server/ — duplicação
 * intencional de uma constante pequena, não uma fonte de verdade paralela
 * (a checagem que realmente protege dado sensível continua sendo a do
 * backend; isto só evita mostrar uma aba que o operador nem consegue usar).
 */
const ROLE_RANK: Record<UserRole, number> = { operator: 0, manager: 1, admin: 2, saas_admin: 3 };

export function hasRoleAtLeast(role: UserRole | undefined | null, min: UserRole): boolean {
  if (!role || !(role in ROLE_RANK)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
