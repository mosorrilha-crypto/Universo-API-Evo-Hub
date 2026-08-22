import React from 'react';
import { CalendarDays, CircleDollarSign, Sparkles } from 'lucide-react';

type OperationsModuleFrameProps = {
  title: string;
  eyebrow: string;
  description: string;
  accent?: 'blue' | 'green';
  children: React.ReactNode;
};

export default function OperationsModuleFrame({ title, eyebrow, description, accent = 'blue', children }: OperationsModuleFrameProps) {
  const Icon = accent === 'green' ? CircleDollarSign : CalendarDays;
  return (
    <section className={`operations-module-frame operations-module-frame--${accent}`} aria-label={title}>
      <header className="operations-module-frame__header">
        <div className="operations-module-frame__identity">
          <div className="operations-module-frame__icon" aria-hidden="true"><Icon size={18} /></div>
          <div>
            <div className="operations-module-frame__eyebrow"><Sparkles size={13} /> {eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        <div className="operations-module-frame__badge">Dados sincronizados com a operação</div>
      </header>
      <div className="operations-module-frame__content">{children}</div>
    </section>
  );
}
