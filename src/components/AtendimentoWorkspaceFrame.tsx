import React from 'react';
import { Bot, CheckCircle2, Clock3, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';

type AtendimentoWorkspaceFrameProps = {
  children: React.ReactNode;
  activeTenantName: string;
  pendingCount: number;
  leadCount: number;
  onOpenEscalations?: () => void;
};

export default function AtendimentoWorkspaceFrame({
  children,
  activeTenantName,
  pendingCount,
  leadCount,
  onOpenEscalations,
}: AtendimentoWorkspaceFrameProps) {
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
        <div className="atendimento-workspace__tenant">
          <span>Empresa ativa</span>
          <strong>{activeTenantName}</strong>
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
