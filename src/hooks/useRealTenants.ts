import { useSyncExternalStore } from 'react';
import { apiFetch } from '../lib/apiClient';

/**
 * Achado real em produção (24/08/2026): a tela "Tenants & Conexões" e os
 * botões de conexão (WhatsApp QR, CAPI, Instagram) mantinham CADA UM sua
 * própria cópia local (`useState`) da lista de tenants, cada um com seu
 * próprio `fetchRealTenants()`. Criar/editar/excluir um tenant só atualizava
 * a cópia de quem agiu — as outras só refletiam depois de um F5 na página.
 * Isso confundiu o dono do produto (achava que o cadastro tinha falhado,
 * quando só a exibição estava desatualizada).
 *
 * Este módulo é uma única fonte compartilhada (fora do React, um "store"
 * simples com assinantes) — qualquer componente que chame `useRealTenants()`
 * lê e re-renderiza a partir do MESMO estado, e qualquer um que chame
 * `refetchRealTenants()` (ex: depois de criar/editar/excluir) atualiza todo
 * mundo que estiver montado, não só quem chamou.
 */
export interface RealTenant {
  id: string;
  name: string;
  slug: string | null;
  segment: string | null;
  currency: string;
  locale: string;
  createdAt: string;
  whatsappConnected: boolean;
  /** TASK-0070 — bloqueio de acesso reversível (tenants.is_active). false = login recusado pra todo operador desse tenant. */
  isActive: boolean;
}

let tenants: RealTenant[] = [];
let isLoading = false;
let hasFetchedOnce = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getTenantsSnapshot(): RealTenant[] {
  return tenants;
}

function getLoadingSnapshot(): boolean {
  return isLoading;
}

let inFlight: Promise<void> | null = null;

/** Busca a lista real (GET /api/admin/tenants) e notifica todo mundo que
 * estiver usando `useRealTenants()`, em qualquer parte do app. Chame depois
 * de criar/editar/excluir um tenant. Reaproveita a busca em andamento se
 * duas chamadas caírem juntas (ex: dois componentes montando ao mesmo tempo). */
export function refetchRealTenants(): Promise<void> {
  if (inFlight) return inFlight;
  isLoading = true;
  notify();
  inFlight = apiFetch('/api/admin/tenants')
    .then(async (res) => {
      const data = res.ok ? await res.json() : null;
      tenants = (data?.tenants || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        slug: t.slug ?? null,
        segment: t.segment ?? null,
        currency: t.currency,
        locale: t.locale,
        createdAt: t.created_at,
        whatsappConnected: !!t.whatsappConnected,
        isActive: t.is_active !== false,
      }));
    })
    .catch((err) => {
      console.error('Falha ao carregar tenants reais:', err);
    })
    .finally(() => {
      isLoading = false;
      hasFetchedOnce = true;
      inFlight = null;
      notify();
    });
  return inFlight;
}

/** Lista real de tenants (tabela `tenants` do Supabase, GET
 * /api/admin/tenants), compartilhada por todo o app — ver comentário do
 * módulo. Busca automaticamente na primeira vez que qualquer componente
 * montar usando este hook; chamadas seguintes só quando `refetchRealTenants`
 * for chamado explicitamente (ex: depois de criar/editar/excluir). */
export function useRealTenants(): { realTenants: RealTenant[]; isLoadingRealTenants: boolean; refetchRealTenants: () => Promise<void> } {
  const realTenants = useSyncExternalStore(subscribe, getTenantsSnapshot);
  const isLoadingRealTenants = useSyncExternalStore(subscribe, getLoadingSnapshot);
  if (!hasFetchedOnce && !inFlight) refetchRealTenants();
  return { realTenants, isLoadingRealTenants, refetchRealTenants };
}
