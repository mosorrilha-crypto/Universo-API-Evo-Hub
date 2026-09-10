import React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Hand,
  LockKeyhole,
  MessageSquareMore,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
} from 'lucide-react';

interface AgentContextUsageDocumentationProps {
  onBack: () => void;
}

type FlowStep = {
  title: string;
  detail: string;
  icon: React.ReactNode;
  tone: 'sky' | 'amber' | 'emerald';
};

const FLOW_STEPS: FlowStep[] = [
  {
    title: 'Atendimento',
    detail: 'Consulte o contexto e trate a conversa pelo canal operacional.',
    icon: <MessageSquareMore className="h-5 w-5" />,
    tone: 'sky',
  },
  {
    title: 'Correção auditável',
    detail: 'O operador corrige somente os campos de memória permitidos.',
    icon: <Wrench className="h-5 w-5" />,
    tone: 'amber',
  },
  {
    title: 'Padrão em revisão',
    detail: 'A Qualidade agrupa sinais recorrentes sem aplicar mudança.',
    icon: <FileSearch className="h-5 w-5" />,
    tone: 'sky',
  },
  {
    title: 'Teste limitado',
    detail: 'A hipótese é observada apenas em triagem, FAQ ou reclamação.',
    icon: <BarChart3 className="h-5 w-5" />,
    tone: 'amber',
  },
  {
    title: 'Decisão humana',
    detail: 'O resultado agregado apoia uma decisão registrada; nada é promovido automaticamente.',
    icon: <Hand className="h-5 w-5" />,
    tone: 'emerald',
  },
];

const FLOW_TONE_CLASSES: Record<FlowStep['tone'], string> = {
  sky: 'border-sky-400/25 bg-sky-500/10 text-sky-200',
  amber: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
  emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
};

const GUIDE_SECTIONS = [
  {
    number: '01',
    title: 'Atenda com contexto, sem substituir a situação real',
    text: 'Em Atendimento, consulte a memória, os estados vivos e o trace redigido antes de agir. A memória explica preferências e histórico estruturado; ela não substitui o status real de agenda, pagamento ou escalonamento.',
    icon: <BrainCircuit className="h-5 w-5" />,
  },
  {
    number: '02',
    title: 'Corrija apenas o que está sob revisão humana',
    text: 'Use a correção de memória para nome preferido, idioma, intenção atual, interesse, objeções e próximo passo. Cada ajuste vira evidência auditável. Não use esse recurso para mudar estados vivos ou contornar confirmações.',
    icon: <Wrench className="h-5 w-5" />,
  },
  {
    number: '03',
    title: 'Transforme recorrência em decisão administrativa',
    text: 'Na aba Memória de Qualidade IA, observe padrões de correção e escolha entre manter em observação, criar rascunho de conhecimento, preparar teste controlado ou dispensar. A fila organiza evidência; não altera o agente.',
    icon: <ClipboardCheck className="h-5 w-5" />,
  },
  {
    number: '04',
    title: 'Desenhe testes pequenos, reversíveis e supervisionados',
    text: 'Na aba Experimentos, parta de um item em teste e registre hipótese, escopo, amostra de 1 a 25 atendimentos, critérios e paradas. Selecione somente Triagem, FAQ e Reclamação. Agendamento permanece fora do escopo.',
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    number: '05',
    title: 'Interprete a leitura antes/depois como sinal',
    text: 'Atualize a leitura para comparar correções humanas, escalonamentos e respostas bloqueadas em janelas equivalentes. O quadro é agregado por tenant, não prova causalidade e nunca promove uma variação automaticamente.',
    icon: <BarChart3 className="h-5 w-5" />,
  },
];

function FlowCard({ step }: { step: FlowStep }) {
  return (
    <article className={`rounded-card border p-3.5 sm:p-4 ${FLOW_TONE_CLASSES[step.tone]}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-current/20 bg-slate-950/25">{step.icon}</span>
        <h3 className="text-sm font-bold leading-tight">{step.title}</h3>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-slate-300">{step.detail}</p>
    </article>
  );
}

export function AgentContextUsageDocumentation({ onBack }: AgentContextUsageDocumentationProps) {
  // TASK-0231: mesma correção da QualityAuditCenter.tsx — `quality-workspace--clear`
  // forçava cores fixas independente do tema (removido de index.css); esta
  // subtela ("Como usar", acessada a partir da Central de Qualidade) tinha o
  // mesmo problema.
  return (
    <section className="quality-workspace space-y-5 animate-fade-in" aria-labelledby="agent-context-guide-title">
      <header className="rounded-card border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-slate-900/70 to-slate-900/70 p-4 sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-2 rounded-control border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/50 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para Qualidade IA
        </button>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              <BookOpen className="h-4 w-4" /> Documentação operacional
            </div>
            <h1 id="agent-context-guide-title" className="mt-2 text-2xl font-bold text-white sm:text-3xl">Como utilizar o contexto supervisionado</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">Este guia mostra como operadores e administradores usam memória, evidências e experimentos para evoluir o atendimento de forma rastreável — sempre com decisão humana no controle.</p>
          </div>
          <div className="flex max-w-xs items-start gap-2 rounded-panel border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>Os gates de alto impacto permanecem humanos em todas as etapas.</span>
          </div>
        </div>
      </header>

      <section aria-labelledby="agent-context-flow-title" className="rounded-card border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-300"><Sparkles className="h-4 w-4" /> Fluxograma de utilização</div>
            <h2 id="agent-context-flow-title" className="mt-1.5 text-lg font-bold text-white">Da conversa à decisão humana</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Cada etapa gera contexto para a próxima, mas nenhuma delas libera uma alteração automática no agente.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[10px] font-bold text-slate-300">Ciclo reversível e auditável</span>
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
          {FLOW_STEPS.map((step, index) => (
            <React.Fragment key={step.title}>
              <FlowCard step={step} />
              {index < FLOW_STEPS.length - 1 && (
                <div className="flex min-h-6 items-center justify-center text-slate-600">
                  <ArrowDown className="h-4 w-4 md:hidden" />
                  <ArrowRight className="hidden h-4 w-4 md:block" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3" aria-label="Etapas detalhadas de utilização">
          {GUIDE_SECTIONS.map((section) => (
            <article key={section.number} className="rounded-card border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-sky-400/20 bg-sky-500/10 text-sky-300">{section.icon}</span>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">Etapa {section.number}</div>
                  <h2 className="mt-1 text-sm font-bold text-white sm:text-base">{section.title}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{section.text}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <aside className="space-y-4" aria-label="Controles e checklist da documentação">
          <section className="rounded-card border border-emerald-500/25 bg-emerald-500/[0.06] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-emerald-200"><LockKeyhole className="h-4 w-4" /><h2 className="text-sm font-bold">Limites que não mudam</h2></div>
            <p className="mt-2 text-xs leading-relaxed text-emerald-100/85">A IA pode consultar fatos e preparar respostas. As ações abaixo exigem a confirmação ou condução humana aplicável.</p>
            <ul className="mt-3 space-y-2 text-xs text-emerald-50">
              {['Confirmação de pagamento', 'Confirmação final de agenda', 'Reembolso, desconto ou exceção', 'Escalonamento e comunicação sensível'].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />{item}</li>)}
            </ul>
          </section>

          <section className="rounded-card border border-amber-500/25 bg-amber-500/[0.06] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-amber-200"><TriangleAlert className="h-4 w-4" /><h2 className="text-sm font-bold">Quando pausar um experimento</h2></div>
            <p className="mt-2 text-xs leading-relaxed text-amber-100/85">Interrompa e registre a decisão quando houver pagamento ou agenda, escalonamento humano, incidente sensível, risco de segurança ou aumento de respostas bloqueadas, inseguras ou incorretas.</p>
          </section>

          <section className="rounded-card border border-sky-500/25 bg-sky-500/[0.06] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sky-200"><ClipboardCheck className="h-4 w-4" /><h2 className="text-sm font-bold">Checklist de encerramento</h2></div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-sky-100/90">
              {['Confirme se o escopo permaneceu em Triagem, FAQ ou Reclamação.', 'Registre a nota e o resumo da decisão humana.', 'Trate a comparação antes/depois como sinal, nunca como prova causal.', 'Não inclua telefone, mensagem, prompt, comprovante ou dados sensíveis na decisão.'].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />{item}</li>)}
            </ul>
          </section>
        </aside>
      </section>

      <section className="rounded-card border border-slate-800 bg-slate-900/70 p-4 sm:p-5" aria-labelledby="metrics-guide-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-300"><BarChart3 className="h-4 w-4" /> Leitura antes/depois</div>
            <h2 id="metrics-guide-title" className="mt-1.5 text-lg font-bold text-white">Como ler as evidências do experimento</h2>
          </div>
          <span className="rounded-pill border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[10px] font-bold text-slate-300">Contagens agregadas por tenant</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Correções humanas', 'Quantidade de ajustes auditáveis de memória no período.', 'Menor é melhor.'],
            ['Escalonamentos', 'Quantidade de escalonamentos criados no período.', 'Menor é melhor.'],
            ['Respostas bloqueadas', 'Conversas em que a IA foi bloqueada no período.', 'Menor é melhor.'],
          ].map(([label, description, direction]) => <article key={label} className="rounded-panel border border-slate-800 bg-slate-950/45 p-3"><h3 className="text-xs font-bold text-white">{label}</h3><p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{description}</p><p className="mt-2 text-[10px] font-bold text-emerald-300">{direction}</p></article>)}
        </div>
        <p className="mt-4 rounded-panel border border-slate-800 bg-slate-950/45 p-3 text-xs leading-relaxed text-slate-300">A comparação usa janelas temporais equivalentes, entre 1 hora e 14 dias. Ela não retorna conteúdo da conversa, telefone, prompt, comprovante, hipótese, variação, notas ou valores corrigidos.</p>
      </section>
    </section>
  );
}
