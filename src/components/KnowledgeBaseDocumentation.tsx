/**
 * Direção visual: Operação Serena. A documentação transforma o modelo de
 * publicação em um percurso legível, sem revelar conteúdo comercial real nem
 * criar atalhos que contornem os controles de rascunho, auditoria e RBAC.
 */
import React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileCheck2,
  FilePenLine,
  FileText,
  History,
  Image,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  Workflow,
} from 'lucide-react';

interface KnowledgeBaseDocumentationProps {
  onBack: () => void;
  isRuntimePublished: boolean;
}

type DocumentTone = 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' | 'cyan' | 'slate' | 'orange';

type DocumentMapItem = {
  type: string;
  title: string;
  description: string;
  detail: string;
  icon: React.ReactNode;
  tone: DocumentTone;
};

const DOCUMENT_TONES: Record<DocumentTone, string> = {
  emerald: 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-200',
  sky: 'border-sky-400/25 bg-sky-500/[0.07] text-sky-200',
  violet: 'border-violet-400/25 bg-violet-500/[0.07] text-violet-200',
  amber: 'border-amber-400/25 bg-amber-500/[0.07] text-amber-100',
  rose: 'border-rose-400/25 bg-rose-500/[0.07] text-rose-100',
  cyan: 'border-cyan-400/25 bg-cyan-500/[0.07] text-cyan-100',
  slate: 'border-slate-600 bg-slate-800/70 text-slate-200',
  orange: 'border-orange-400/25 bg-orange-500/[0.07] text-orange-100',
};

const DOCUMENT_MAP: DocumentMapItem[] = [
  {
    type: 'business_profile',
    title: 'Perfil do negócio',
    description: 'Empresa, objetivo, modelo de negócio e localização.',
    detail: 'É a referência inicial para o agente entender quem atende e qual necessidade a empresa resolve.',
    icon: <Store className="h-4 w-4" />,
    tone: 'emerald',
  },
  {
    type: 'brand_voice',
    title: 'Voz da marca',
    description: 'Tom, idioma e estilo de conversa.',
    detail: 'Define como o agente se expressa, sem substituir os controles universais de segurança.',
    icon: <MessageSquareText className="h-4 w-4" />,
    tone: 'sky',
  },
  {
    type: 'service_catalog',
    title: 'Catálogo de serviços',
    description: 'Produtos, variações, preços, duração, status e mídias.',
    detail: 'Mantém os dados comerciais estruturados usados para cotação, visibilidade e agendamento.',
    icon: <Layers3 className="h-4 w-4" />,
    tone: 'violet',
  },
  {
    type: 'pricing_policies',
    title: 'Preços e políticas',
    description: 'Regras comerciais, pagamento e limites de negociação.',
    detail: 'Dá contexto para o atendimento, mas não autoriza o agente a criar exceções por conta própria.',
    icon: <FileText className="h-4 w-4" />,
    tone: 'amber',
  },
  {
    type: 'opening_hours',
    title: 'Horários',
    description: 'Espaço reservado para a fonte estruturada de horários.',
    detail: 'Nesta versão, o horário de trabalho continua no controle próprio de Horários da Base de Conhecimento.',
    icon: <Clock3 className="h-4 w-4" />,
    tone: 'slate',
  },
  {
    type: 'faq',
    title: 'Perguntas frequentes',
    description: 'Dúvidas e respostas aprovadas.',
    detail: 'Organiza respostas recorrentes para que o agente não precise supor condições comerciais ou operacionais.',
    icon: <CircleHelp className="h-4 w-4" />,
    tone: 'rose',
  },
  {
    type: 'human_handoff_rules',
    title: 'Encaminhamento humano',
    description: 'Espaço reservado para regras estruturadas de escalonamento.',
    detail: 'Nesta versão, não possui campos editáveis no documento; os gates humanos existentes continuam obrigatórios.',
    icon: <UserRound className="h-4 w-4" />,
    tone: 'orange',
  },
  {
    type: 'media_assets',
    title: 'Mídias e primeiro contato',
    description: 'Anexos e sequência inicial de texto, imagem, vídeo ou arquivo.',
    detail: 'Reúne os materiais usados no atendimento inicial; mídias específicas de produto continuam dentro do catálogo.',
    icon: <Image className="h-4 w-4" />,
    tone: 'cyan',
  },
];

const CHANGE_FLOW = [
  { title: 'Escolha o assunto', detail: 'Abra um dos 8 documentos para editar somente o bloco necessário.', icon: <BookOpen className="h-5 w-5" />, tone: 'sky' as const },
  { title: 'Salve o rascunho', detail: 'A validação aceita apenas os campos do contrato e nada muda no agente.', icon: <FilePenLine className="h-5 w-5" />, tone: 'amber' as const },
  { title: 'Revise a versão', detail: 'Confira o resumo, o histórico e o impacto comercial antes de promover a mudança.', icon: <History className="h-5 w-5" />, tone: 'violet' as const },
  { title: 'Publique com confirmação', detail: 'A publicação substitui a versão vigente e registra uma trilha de auditoria.', icon: <FileCheck2 className="h-5 w-5" />, tone: 'emerald' as const },
  { title: 'Atendimento consulta a fonte ativa', detail: 'A próxima resposta usa somente a publicação completa; rascunhos ficam excluídos.', icon: <Sparkles className="h-5 w-5" />, tone: 'cyan' as const },
];

function DocumentCard({ item }: { item: DocumentMapItem; key?: React.Key }) {
  return (
    <article className={`rounded-xl border p-3.5 ${DOCUMENT_TONES[item.tone]}`}>
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-slate-950/25">{item.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.13em] opacity-70">{item.type}</p>
          <h3 className="mt-0.5 text-xs font-bold text-white">{item.title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-300">{item.description}</p>
        </div>
      </div>
      <p className="mt-3 border-t border-current/15 pt-2.5 text-[10px] leading-4 text-slate-400">{item.detail}</p>
    </article>
  );
}

export function KnowledgeBaseDocumentation({ onBack, isRuntimePublished }: KnowledgeBaseDocumentationProps) {
  const sourceLabel = isRuntimePublished ? 'Publicação tipada ativa' : 'Publicação tipada em preparação';
  const sourceDescription = isRuntimePublished
    ? 'O agente e o catálogo consultam os documentos publicados a cada novo atendimento. Rascunhos e versões arquivadas ficam fora do runtime.'
    : 'Os documentos tipados já podem ser preparados e auditados. Nesta etapa, a fonte de runtime ainda é a Base de Conhecimento legada.';

  return (
    <section className="knowledge-workspace space-y-5" aria-labelledby="knowledge-base-guide-title">
      <header className="rounded-2xl border border-cyan-400/25 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,0.16),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(15,23,42,0.84))] p-4 shadow-xl sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/50 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para a Base de Conhecimento
        </button>

        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300"><BookOpen className="h-4 w-4" /> Documentação da Base de Conhecimento</div>
            <h1 id="knowledge-base-guide-title" className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Do conteúdo revisado à resposta do agente</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">Este mapa explica onde cada informação fica, como uma alteração é revisada e por que o rascunho nunca entra sozinho no atendimento. Ele organiza a aprendizagem de novos operadores sem ocultar os campos e controles já existentes.</p>
          </div>
          <div className="flex max-w-sm items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span><strong>{sourceLabel}.</strong> {sourceDescription}</span>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5" aria-labelledby="knowledge-map-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300"><Workflow className="h-4 w-4" /> Mapa lógico</div>
            <h2 id="knowledge-map-title" className="mt-1 text-lg font-bold text-white">Os oito documentos que formam a publicação</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Cada documento cuida de um assunto. Juntos, os oito formam uma publicação completa e evitam que uma mudança de catálogo se misture com regras, tom de voz ou mídias.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[10px] font-bold text-slate-300"><Layers3 className="h-3.5 w-3.5 text-cyan-300" /> 8 blocos independentes</span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {DOCUMENT_MAP.map((item) => <DocumentCard item={item} key={item.type} />)}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5" aria-labelledby="knowledge-change-flow-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300"><Workflow className="h-4 w-4" /> Fluxograma de alteração</div>
            <h2 id="knowledge-change-flow-title" className="mt-1 text-lg font-bold text-white">Uma mudança só chega ao agente depois de ser publicada</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">O caminho mantém a edição reversível e torna cada decisão rastreável por versão.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-100"><LockKeyhole className="h-3.5 w-3.5" /> Rascunho não é produção</span>
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
          {CHANGE_FLOW.map((step, index) => (
            <React.Fragment key={step.title}>
              <article className={`rounded-xl border p-3.5 ${DOCUMENT_TONES[step.tone]}`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-current/20 bg-slate-950/25">{step.icon}</span>
                <h3 className="mt-3 text-xs font-bold text-white">{step.title}</h3>
                <p className="mt-1.5 text-[11px] leading-4 text-slate-300">{step.detail}</p>
              </article>
              {index < CHANGE_FLOW.length - 1 && <div className="flex min-h-5 items-center justify-center text-slate-600"><ArrowDown className="h-4 w-4 md:hidden" /><ArrowRight className="hidden h-4 w-4 md:block" /></div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-md sm:p-5" aria-labelledby="knowledge-runtime-title">
          <div className="flex items-center gap-2 text-cyan-200"><Sparkles className="h-4 w-4" /><h2 id="knowledge-runtime-title" className="text-sm font-bold">Como o agente escolhe a fonte de informação</h2></div>
          <div className="mt-4 space-y-2">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">1. Publicação completa</p><p className="mt-1 text-xs leading-5 text-slate-200">Com os oito documentos publicados, o runtime compõe a Base de Conhecimento somente com as versões publicadas. A leitura é refeita em cada nova resposta.</p></div>
            <div className="flex justify-center text-slate-600"><ArrowDown className="h-4 w-4" /></div>
            <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200">2. Proteção de continuidade</p><p className="mt-1 text-xs leading-5 text-slate-200">Se a publicação estiver incompleta ou indisponível, a Base legada é usada somente como fallback rastreável para não interromper o atendimento.</p></div>
            <div className="flex justify-center text-slate-600"><ArrowDown className="h-4 w-4" /></div>
            <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-200">3. Sem inventar informação</p><p className="mt-1 text-xs leading-5 text-slate-200">Se nenhuma fonte estiver disponível, o sistema registra indisponibilidade. Ele não preenche preço, política, agenda ou conteúdo comercial por suposição.</p></div>
          </div>
        </article>

        <aside className="space-y-4" aria-label="Regras de utilização da Base de Conhecimento">
          <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-emerald-100"><CheckCircle2 className="h-4 w-4 text-emerald-300" /><h2 className="text-sm font-bold">Roteiro para novos usuários</h2></div>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-emerald-50/90">
              {['Comece pelo Perfil do negócio e pela Voz da marca.', 'Cadastre ou revise serviços, variações, valores e duração no Catálogo.', 'Consolide condições comerciais em Preços e políticas e dúvidas recorrentes em FAQ.', 'Inclua anexos e a sequência de primeiro contato quando forem necessários.', 'Salve como rascunho, revise e publique somente quando estiver pronto.'].map((item, index) => <li key={item} className="flex gap-2"><span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-300/30 text-[9px] font-bold text-emerald-200">{index + 1}</span>{item}</li>)}
            </ol>
          </section>

          <section className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-amber-100"><ShieldAlert className="h-4 w-4 text-amber-300" /><h2 className="text-sm font-bold">Controles que preservam a operação</h2></div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-amber-50/90">
              {['Salvar altera apenas o rascunho; publicar pede confirmação explícita.', 'Versões publicadas e rascunhos ficam separadas por empresa e por permissão.', 'O histórico registra criação de rascunho, atualização e publicação.', 'O editor legado permanece disponível para auditoria e rollback, mas não salva quando a publicação tipada está ativa.'].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{item}</li>)}
            </ul>
          </section>
        </aside>
      </section>
    </section>
  );
}
