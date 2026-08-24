import React, { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, Clock3, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';
import { Tenant } from '../types';

type AtendimentoWorkspaceFrameProps = {
  children: React.ReactNode;
  activeTenantName: string;
  pendingCount: number;
  leadCount: number;
  onOpenEscalations?: () => void;
  tenants?: Tenant[];
  activeTenant?: Tenant;
  canSwitchTenant?: boolean;
  onSelectTenant?: (tenant: Tenant) => void;
};

export default function AtendimentoWorkspaceFrame({
  children,
  activeTenantName,
  pendingCount,
  leadCount,
  onOpenEscalations,
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
      <header className="atendimento-workspace__header">
        <div className="atendimento-workspace__identity">
          <div className="atendimento-workspace__icon" aria-hidden="true"><MessageSquareText size={18} /></div>
          <div>
            <div className="atendimento-workspace__eyebrow"><Sparkles size={13} /> Central operacional</div>
            <h1>Atendimento</h1>
            <p>Conduza cada conversa até a próxima ação certa, com a IA sob supervisão humana.</p>
          </div>
        </div>
        <div className="atendimento-workspace__tenant" ref={tenantMenuRef}>
          <span>Empresa ativa</span>
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

      <div className="atendimento-workspace__signals" aria-label="Resumo da operação">
        <div className="atendimento-signal">
          <span className="atendimento-signal__icon atendimento-signal__icon--green"><CheckCircle2 size={15} /></span>
          <div><strong>{leadCount}</strong><span>conversas em acompanhamento</span></div>
        </div>
        <button type="button" className="atendimento-signal atendimento-signal--button" onClick={onOpenEscalations} disabled={!onOpenEscalations}>
          <span className="atendimento-signal__icon atendimento-signal__icon--amber"><Clock3 size={15} /></span>
          <div><strong>{pendingCount}</strong><span>pendências humanas</span></div>
        </button>
        <div className="atendimento-signal">
          <span className="atendimento-signal__icon atendimento-signal__icon--blue"><Bot size={15} /></span>
          <div><strong>IA supervisionada</strong><span>rascunhos aguardam aprovação</span></div>
        </div>
        <div className="atendimento-workspace__approval"><ShieldCheck size={15} /> Nenhuma mensagem é enviada sem aprovação</div>
      </div>

      <div className="atendimento-workspace__content">{children}</div>
    </section>
  );
}
