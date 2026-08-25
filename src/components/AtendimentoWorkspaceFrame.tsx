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

/**
 * Achado real de UI (pedido do dono do produto, 25/08/2026, com print do
 * celular): este resumo (ícone+título, cartões de contagem, aviso de "IA
 * supervisionada") é conteúdo majoritariamente estático — muda pouco entre
 * mensagens — mas ocupava boa parte da tela útil em mobile antes de
 * qualquer conversa aparecer. Vira recolhível, começando FECHADO por
 * padrão (o pedido era por uma "página de atendimento limpa e exclusiva"),
 * com a preferência lembrada por navegador (mesmo padrão de
 * AppPreferencesContext) — quem prefere ver sempre não precisa reabrir a
 * cada visita.
 */
const SUMMARY_OPEN_STORAGE_KEY = 'atendimento_summary_open';

function readSummaryOpenPreference(): boolean {
  try {
    return localStorage.getItem(SUMMARY_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

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
  const [isSummaryOpen, setIsSummaryOpen] = useState(() => readSummaryOpenPreference());
  const canSelectTenant = canSwitchTenant && tenants.length > 1 && Boolean(activeTenant && onSelectTenant);

  useEffect(() => {
    try {
      localStorage.setItem(SUMMARY_OPEN_STORAGE_KEY, String(isSummaryOpen));
    } catch {
      // localStorage indisponível (modo privado/cookies bloqueados) — a
      // preferência só não persiste entre visitas, o toggle continua
      // funcionando normalmente dentro da sessão atual.
    }
  }, [isSummaryOpen]);

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

      <button
        type="button"
        className="atendimento-workspace__summary-toggle"
        onClick={() => setIsSummaryOpen((value) => !value)}
        aria-expanded={isSummaryOpen}
        aria-controls="atendimento-summary"
      >
        <span>
          Resumo da operação
          {pendingCount > 0 ? ` · ${pendingCount} pendência${pendingCount === 1 ? '' : 's'} humana${pendingCount === 1 ? '' : 's'}` : ''}
        </span>
        <ChevronDown className={`atendimento-workspace__summary-chevron${isSummaryOpen ? ' is-open' : ''}`} size={15} aria-hidden="true" />
      </button>

      {isSummaryOpen && (
        <div id="atendimento-summary" className="atendimento-workspace__signals" aria-label="Resumo da operação">
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
      )}

      <div className="atendimento-workspace__content">{children}</div>
    </section>
  );
}
