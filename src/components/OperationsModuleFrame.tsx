/**
 * Moldura operacional — variante compacta remove hero redundante no
 * Financeiro móvel. `hideHeader` remove o cabeçalho em qualquer largura:
 * Agenda e Financeiro usam pra evitar duplicar o título/eyebrow/descrição
 * que `AgendaFinanceiroCenter` já renderiza no próprio hero interno (achado
 * real, 04/09/2026 — dois blocos "Agenda" empilhados no desktop, pedido
 * direto do usuário pra encontrar desperdícios de espaço). CRM continua sem
 * `hideHeader` porque `CrmWorkspace` não tem hero próprio e depende deste
 * cabeçalho pro título aparecer no desktop.
 */
import React from 'react';
import { CalendarDays, CircleDollarSign, Sparkles } from 'lucide-react';

type OperationsModuleFrameProps = {
  title: string;
  eyebrow: string;
  description: string;
  accent?: 'blue' | 'green';
  compact?: boolean;
  hideHeader?: boolean;
  children: React.ReactNode;
};

export default function OperationsModuleFrame({ title, eyebrow, description, accent = 'blue', compact = false, hideHeader = false, children }: OperationsModuleFrameProps) {
  const Icon = accent === 'green' ? CircleDollarSign : CalendarDays;
  return (
    <section className={`operations-module-frame operations-module-frame--${accent}${compact ? ' operations-module-frame--compact' : ''}`} aria-label={title}>
      {!hideHeader && <header className="operations-module-frame__header">
        <div className="operations-module-frame__identity">
          <div className="operations-module-frame__icon" aria-hidden="true"><Icon size={18} /></div>
          <div>
            <div className="operations-module-frame__eyebrow"><Sparkles size={13} /> {eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        <div className="operations-module-frame__badge">Dados sincronizados com a operação</div>
      </header>}
      <div className="operations-module-frame__content">{children}</div>
    </section>
  );
}
