import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, MessageSquareText } from 'lucide-react';
import { Tenant } from '../types';

type AtendimentoWorkspaceFrameProps = {
  children: React.ReactNode;
  activeTenantName: string;
  tenants?: Tenant[];
  activeTenant?: Tenant;
  canSwitchTenant?: boolean;
  onSelectTenant?: (tenant: Tenant) => void;
};

/**
 * Refinamento de UI (pedido do dono do produto, 28/08/2026, com print
 * comparando lado a lado com o app real do WhatsApp): o card de "Resumo da
 * operação" (título grande + estatísticas 223 conversas/pendências/IA
 * supervisionada) foi removido por completo — repetia informação que já
 * fica visível na própria lista de conversas logo abaixo, e ocupava tela
 * útil que o WhatsApp real não gasta com isso. O cabeçalho vira uma faixa
 * fina, só com o nome do app e a empresa ativa — mais perto do "WhatsApp"
 * simples do topo do app real do que de um painel de métricas.
 */
export default function AtendimentoWorkspaceFrame({
  children,
  activeTenantName,
  tenants = [],
  activeTenant,
  canSwitchTenant = false,
  onSelectTenant,
}: AtendimentoWorkspaceFrameProps) {
  const tenantMenuRef = useRef<HTMLDivElement>(null);
  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);
  const canSelectTenant = canSwitchTenant && tenants.length > 1 && Boolean(activeTenant && onSelectTenant);

  useEffect(() => {
    if (!isTenantMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (tenantMenuRef.current && !tenantMenuRef.current.contains(event.target as Node)) setIsTenantMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsTenantMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isTenantMenuOpen]);

  useEffect(() => {
    if (!canSelectTenant) setIsTenantMenuOpen(false);
  }, [canSelectTenant]);

  const selectTenant = (tenant: Tenant) => {
    onSelectTenant?.(tenant);
    setIsTenantMenuOpen(false);
  };

  return (
    <section className="atendimento-workspace" aria-label="Central de atendimento">
      <header className="atendimento-workspace__header atendimento-workspace__header--compact">
        <div className="atendimento-workspace__identity">
          <div className="atendimento-workspace__icon" aria-hidden="true"><MessageSquareText size={16} /></div>
          <h1>Atendimento</h1>
        </div>
        <div className="atendimento-workspace__tenant" ref={tenantMenuRef}>
          {canSelectTenant ? (
            <>
              <button
                type="button"
                className="atendimento-workspace__tenant-trigger"
                aria-haspopup="menu"
                aria-expanded={isTenantMenuOpen}
                aria-controls="atendimento-tenant-menu"
                aria-label={`Trocar empresa ativa. Empresa atual: ${activeTenantName}`}
                onClick={() => setIsTenantMenuOpen((value) => !value)}
              >
                <strong>{activeTenantName}</strong>
                <ChevronDown className={`atendimento-workspace__tenant-chevron${isTenantMenuOpen ? ' is-open' : ''}`} size={15} aria-hidden="true" />
              </button>
              {isTenantMenuOpen && (
                <div id="atendimento-tenant-menu" className="atendimento-workspace__tenant-menu" role="menu" aria-label="Selecionar empresa ativa">
                  {tenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      role="menuitem"
                      className={`atendimento-workspace__tenant-option${tenant.id === activeTenant?.id ? ' is-active' : ''}`}
                      onClick={() => selectTenant(tenant)}
                    >
                      <span>{tenant.name}</span>
                      {tenant.id === activeTenant?.id && <CheckCircle2 size={14} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <strong>{activeTenantName}</strong>
          )}
        </div>
      </header>

      <div className="atendimento-workspace__content">{children}</div>
    </section>
  );
}
