/**
 * TASK-0319 (pedido direto, 2 prints anotados à mão do celular): a
 * `.atendimento-bottom-nav` (Conversas/Pendências/Agenda/Ferramentas) só
 * existe dentro de `WhatsAppLeadsSim.tsx`, montada sempre mas escondida via
 * `hidden` no wrapper de `App.tsx` sempre que `activeTab !== 'whatsapp'`
 * (`display:none` no ancestral apaga o subtree inteiro, nav incluída) — ao
 * abrir "Pendências" ou "Agenda" no celular, o menu inferior some por
 * completo, tirando a possibilidade de voltar pra "Conversas" pelo mesmo
 * caminho. O `FloatingAttendanceButton` (atalho circular arrastável) já
 * cobre tecnicamente a volta, mas é discreto e não é o "menu de baixo" que
 * o usuário está pedindo de volta.
 *
 * Este componente reaproveita o MESMO CSS de `.atendimento-bottom-nav`
 * (index.css), mas é standalone — não depende de nenhum estado interno de
 * `WhatsAppLeadsSim` — e cobre só Conversas/Pendências/Agenda (as 3 telas
 * que fazem sentido navegar direto a partir de Escalonamentos/Agenda).
 * "Ferramentas" (status do agente, notificações) é específico da tela de
 * conversas e não foi replicado aqui.
 */
import React from 'react';
import { AlertTriangle, CalendarDays, MessageCircle } from 'lucide-react';

type AtendimentoSecondaryNavProps = {
  activeTab: 'escalations' | 'agenda';
  onGoToConversas: () => void;
  onGoToEscalations: () => void;
  onGoToAgenda?: () => void;
  escalationsPendingCount: number;
};

export function AtendimentoSecondaryNav({
  activeTab,
  onGoToConversas,
  onGoToEscalations,
  onGoToAgenda,
  escalationsPendingCount,
}: AtendimentoSecondaryNavProps) {
  return (
    <nav
      className="atendimento-bottom-nav lg:!hidden fixed inset-x-0 bottom-0 z-40"
      aria-label="Navegação secundária do Atendimento"
    >
      <button type="button" onClick={onGoToConversas} className="atendimento-bottom-nav__item">
        <MessageCircle className="w-6 h-6" />
        <span>Conversas</span>
      </button>
      <button
        type="button"
        onClick={onGoToEscalations}
        className={`atendimento-bottom-nav__item${activeTab === 'escalations' ? ' is-active' : ''}`}
      >
        <AlertTriangle className="w-6 h-6" />
        <span>Pendências</span>
        {escalationsPendingCount > 0 && (
          <span className="atendimento-bottom-nav__badge">{escalationsPendingCount}</span>
        )}
      </button>
      {onGoToAgenda && (
        <button
          type="button"
          onClick={onGoToAgenda}
          className={`atendimento-bottom-nav__item${activeTab === 'agenda' ? ' is-active' : ''}`}
        >
          <CalendarDays className="w-6 h-6" />
          <span>Agenda</span>
        </button>
      )}
    </nav>
  );
}
