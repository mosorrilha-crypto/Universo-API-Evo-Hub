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
 * `WhatsAppLeadsSim`.
 *
 * TASK-0326 (pedido direto, prints anotados comparando com o WhatsApp real):
 * os 4 ícones (Conversas/Pendências/Agenda/Ferramentas) devem ficar sempre
 * visíveis em qualquer tela do Atendimento — só devem sumir quando uma
 * conversa está aberta (mesmo comportamento do WhatsApp real). Antes deste
 * ajuste, "Ferramentas" só existia dentro de Conversas — adicionado aqui
 * como o 4º item; como o menu de ferramentas em si é estado local de
 * `WhatsAppLeadsSim`, `onGoToTools` (assim como o novo comportamento de
 * `onGoToAgenda`, que agora sempre abre o mesmo popup rápido de eventos em
 * vez de navegar pra página completa) navega pra Conversas e sinaliza a
 * ação pendente via `pendingConversasAction` (App.tsx/WhatsAppLeadsSim).
 */
import React from 'react';
import { AlertTriangle, CalendarDays, MessageCircle, Settings } from 'lucide-react';

type AtendimentoSecondaryNavProps = {
  activeTab: 'escalations' | 'agenda';
  onGoToConversas: () => void;
  onGoToEscalations: () => void;
  onGoToAgenda?: () => void;
  onGoToTools: () => void;
  escalationsPendingCount: number;
};

export function AtendimentoSecondaryNav({
  activeTab,
  onGoToConversas,
  onGoToEscalations,
  onGoToAgenda,
  onGoToTools,
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
      <button type="button" onClick={onGoToTools} className="atendimento-bottom-nav__item">
        <Settings className="w-6 h-6" />
        <span>Ferramentas</span>
      </button>
    </nav>
  );
}
