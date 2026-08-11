/**
 * Restrição de telas por papel (issue #159): atendente ("operator") não
 * deve ver Financeiro nem telas administrativas. Mesma hierarquia do
 * backend (server/middleware/rbac.ts) — testando aqui só a lógica pura de
 * comparação, não os componentes React que a consomem (Header.tsx/App.tsx).
 */
import { describe, expect, it } from 'vitest';
import { hasRoleAtLeast } from '../roles';

describe('hasRoleAtLeast', () => {
  it('operator não atende nenhum nível acima do próprio', () => {
    expect(hasRoleAtLeast('operator', 'operator')).toBe(true);
    expect(hasRoleAtLeast('operator', 'manager')).toBe(false);
    expect(hasRoleAtLeast('operator', 'admin')).toBe(false);
    expect(hasRoleAtLeast('operator', 'saas_admin')).toBe(false);
  });

  it('manager vê Financeiro (manager+) mas não as ferramentas de admin', () => {
    expect(hasRoleAtLeast('manager', 'manager')).toBe(true);
    expect(hasRoleAtLeast('manager', 'admin')).toBe(false);
  });

  it('admin vê tudo exceto o Painel SaaS Master', () => {
    expect(hasRoleAtLeast('admin', 'manager')).toBe(true);
    expect(hasRoleAtLeast('admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('admin', 'saas_admin')).toBe(false);
  });

  it('saas_admin vê absolutamente tudo (topo da hierarquia)', () => {
    expect(hasRoleAtLeast('saas_admin', 'operator')).toBe(true);
    expect(hasRoleAtLeast('saas_admin', 'manager')).toBe(true);
    expect(hasRoleAtLeast('saas_admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('saas_admin', 'saas_admin')).toBe(true);
  });

  it('sem papel (não logado / sessão inválida) nunca atende nada', () => {
    expect(hasRoleAtLeast(undefined, 'operator')).toBe(false);
    expect(hasRoleAtLeast(null, 'operator')).toBe(false);
  });
});
