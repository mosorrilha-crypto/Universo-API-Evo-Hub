import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de dados que acompanha requisições autenticadas e tarefas que já
 * resolveram o tenant de forma confiável. Ele é a única fonte usada pela
 * camada de dados para emitir o JWT curto que o PostgREST entrega ao RLS.
 *
 * Não aceite valores de body/query aqui. Chamadores HTTP devem passar pelo
 * middleware de autenticação; webhooks devem resolver o canal antes de abrir
 * este contexto.
 */
export interface TenantDbContext {
  tenantId: string;
  actorId?: string;
  role?: string;
  source: 'authenticated_request' | 'webhook' | 'job';
}

const storage = new AsyncLocalStorage<TenantDbContext>();

export function runWithTenantDbContext<T>(context: TenantDbContext, callback: () => T): T {
  if (!context.tenantId) {
    throw new Error('Contexto de tenant ausente — acesso RLS recusado.');
  }
  return storage.run(context, callback);
}

export function getTenantDbContext(): TenantDbContext | undefined {
  return storage.getStore();
}

/**
 * Troca o tenant apenas dentro da cadeia assíncrona atual. É usado pelo
 * seletor de saas_admin depois que `resolveTenantId` valida o header; papéis
 * comuns nunca chegam a esta função.
 */
export function replaceTenantInCurrentDbContext(tenantId: string): void {
  const current = storage.getStore();
  // Testes puramente de autorização podem chamar resolveTenantId sem abrir
  // uma requisição/contexto de dados. Em runtime, getDb() continuará negando
  // qualquer acesso sem contexto; aqui apenas não há nada a sincronizar.
  if (!current) return;
  if (!tenantId) {
    throw new Error('tenantId inválido ao tentar trocar o contexto RLS.');
  }
  storage.enterWith({ ...current, tenantId });
}

/** Exportado exclusivamente para testes, para evitar contexto residual entre casos. */
export function disableTenantDbContextForTests(): void {
  storage.disable();
}
