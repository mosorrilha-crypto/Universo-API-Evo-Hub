import React from 'react';
import { FullConversationAnalysis } from '../types';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  DollarSign,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Languages,
  Lightbulb,
  Loader2,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
} from 'lucide-react';

/** Resultado de POST /api/ai/reply-from-hint. */
export interface HintReplyResult {
  reply: string;
  translation?: string;
  detectedLanguage?: string;
  error?: string;
}

/** Resultado de POST /api/ai/ask. */
export interface AskAiResult {
  answer: string;
  error?: string;
}

interface ConversationAnalysisPanelProps {
  analysis?: FullConversationAnalysis;
  isLoading: boolean;
  onReanalyze: () => void;
  /** Envia a mensagem diretamente. Deve permanecer uma ação explícita, pois pode disparar WhatsApp real. */
  onApplySuggestedReply?: (reply: string) => void;
  /** Preenche o compositor do WhatsApp sem enviar, para revisão humana antes da ação irreversível. */
  onDraftSuggestedReply?: (reply: string) => void;
  leadName: string;
  onSendCAPIEvent?: (eventName: 'Lead' | 'Contact' | 'QualifiedLead' | 'Schedule' | 'PurchaseIntention' | 'Purchase') => void;
  onGenerateReplyFromHint?: (hint: string) => Promise<HintReplyResult>;
  onAskAi?: (question: string) => Promise<AskAiResult>;
}

/** Atalhos que descrevem o objetivo de negócio, não uma fórmula vaga de texto. */
const HINT_SUGGESTIONS: Array<{ label: string; hint: string }> = [
  {
    label: 'Responder a última dúvida',
    hint: 'Responda primeiro e com precisão à última dúvida da cliente. Depois faça somente uma pergunta curta que ajude a avançar a conversa.',
  },
  {
    label: 'Tratar preço com valor',
    hint: 'Acolha a preocupação com o valor, explique um benefício real presente na base de conhecimento e descubra qual é a dúvida principal, sem oferecer desconto ou pressionar.',
  },
  {
    label: 'Retomar com leveza',
    hint: 'A cliente parou de responder. Retome com uma mensagem leve, útil e sem cobrança, convidando-a a dizer se ainda quer ajuda.',
  },
  {
    label: 'Confirmar intenção',
    hint: 'Confirme de forma natural se a cliente quer avançar com o serviço e peça somente o dado que falta para o próximo passo.',
  },
  {
    label: 'Preparar agendamento',
    hint: 'Se a cliente demonstrou intenção real, reúna nome, serviço e dia desejado antes de consultar disponibilidade. Não prometa horário.',
  },
  {
    label: 'Encurtar resposta',
    hint: 'Reescreva de forma mais curta, direta e humana, mantendo a resposta à dúvida real e uma única pergunta de continuidade.',
  },
];

function getStageBadge(stage: string) {
  if (stage.includes('Fechamento') || stage.includes('Quente') || stage.includes('ganho')) {
    return { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', icon: Flame };
  }
  if (stage.includes('Morno') || stage.includes('negociacao') || stage.includes('proposta')) {
    return { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300', icon: TrendingUp };
  }
  if (stage.includes('Objeção') || stage.includes('Perdido') || stage.includes('perdido')) {
    return { bg: 'bg-rose-500/15 border-rose-500/30 text-rose-300', icon: AlertCircle };
  }
  return { bg: 'bg-blue-500/15 border-blue-500/30 text-blue-300', icon: HelpCircle };
}

function SignalCard({ icon: Icon, label, value, tone = 'slate' }: { icon: React.ElementType; label: string; value: string; tone?: 'slate' | 'rose' | 'amber' }) {
  const tones = {
    slate: 'bg-slate-950 border-slate-800 text-slate-200 icon:text-emerald-400',
    rose: 'bg-rose-950/25 border-rose-500/25 text-rose-100 icon:text-rose-400',
    amber: 'bg-amber-950/20 border-amber-500/20 text-amber-100 icon:text-amber-400',
  };
  return (
    <div className={`rounded-xl border p-2.5 ${tones[tone]}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
        <Icon className="w-3 h-3 icon" />
        {label}
      </span>
      <p className="mt-1 text-xs font-semibold leading-snug">{value}</p>
    </div>
  );
}

export const ConversationAnalysisPanel: React.FC<ConversationAnalysisPanelProps> = ({
  analysis,
  isLoading,
  onReanalyze,
  onApplySuggestedReply,
  onDraftSuggestedReply,
  leadName,
  onSendCAPIEvent,
  onGenerateReplyFromHint,
  onAskAi,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [hintDraft, setHintDraft] = React.useState('');
  const [isGeneratingHintReply, setIsGeneratingHintReply] = React.useState(false);
  const [hintReplyResult, setHintReplyResult] = React.useState<HintReplyResult | null>(null);
  const [hintReplyCopied, setHintReplyCopied] = React.useState(false);
  const [showHintComposer, setShowHintComposer] = React.useState(false);
  const [showContext, setShowContext] = React.useState(false);
  const [showCapiSection, setShowCapiSection] = React.useState(false);
  const [showAskAiSection, setShowAskAiSection] = React.useState(false);
  const [questionDraft, setQuestionDraft] = React.useState('');
  const [isAsking, setIsAsking] = React.useState(false);
  const [askResult, setAskResult] = React.useState<AskAiResult | null>(null);

  const hasReadySuggestedReply = !!analysis && analysis.source !== 'fallback' && !!analysis.suggestedSmartReply;
  const hintComposerOpen = showHintComposer || !hasReadySuggestedReply;
  const badgeStyle = analysis ? getStageBadge(analysis.leadStage || '') : null;
  const BadgeIcon = badgeStyle?.icon;
  const actionObjective = analysis?.actionObjective || analysis?.recommendedNextAction || 'Defina a próxima ação com base na última mensagem da cliente.';
  const actionReason = analysis?.actionRationale || analysis?.extractedCRMData?.decisionCriteria || 'Use o histórico para responder ao que a cliente realmente precisa agora.';
  const actionGuardrail = analysis?.actionGuardrail || 'Não prometa horário, pagamento, desconto, resultado ou informação que não esteja confirmada.';

  const handleCopyReply = (reply: string, source: 'analysis' | 'hint') => {
    navigator.clipboard.writeText(reply);
    if (source === 'analysis') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setHintReplyCopied(true);
      setTimeout(() => setHintReplyCopied(false), 2000);
    }
  };

  const handleGenerateHintReply = async () => {
    if (!hintDraft.trim() || !onGenerateReplyFromHint) return;
    setIsGeneratingHintReply(true);
    setHintReplyResult(null);
    try {
      setHintReplyResult(await onGenerateReplyFromHint(hintDraft.trim()));
    } catch (err: any) {
      setHintReplyResult({ reply: '', error: err.message || 'Falha ao gerar resposta.' });
    } finally {
      setIsGeneratingHintReply(false);
    }
  };

  const handleAsk = async () => {
    if (!questionDraft.trim() || !onAskAi) return;
    setIsAsking(true);
    setAskResult(null);
    try {
      setAskResult(await onAskAi(questionDraft.trim()));
    } catch (err: any) {
      setAskResult({ answer: '', error: err.message || 'Falha ao consultar a IA.' });
    } finally {
      setIsAsking(false);
    }
  };

  const renderReplyActions = (reply: string, origin: 'analysis' | 'hint') => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {onDraftSuggestedReply && (
        <button
          type="button"
          onClick={() => onDraftSuggestedReply(reply)}
          className="min-h-10 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <PencilLine className="w-3.5 h-3.5" />
          Editar antes de enviar
        </button>
      )}
      {onApplySuggestedReply && (
        <button
          type="button"
          onClick={() => onApplySuggestedReply(reply)}
          className="min-h-10 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          Enviar agora
        </button>
      )}
      {!onDraftSuggestedReply && !onApplySuggestedReply && (
        <button
          type="button"
          onClick={() => handleCopyReply(reply, origin)}
          className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" />
          Copiar mensagem
        </button>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl space-y-3.5">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">Orientador de conversa</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">Decida, revise e envie com contexto para {leadName}.</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {analysis?.detectedLanguage && (
                <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-300">
                  <Globe className="w-2.5 h-2.5" /> {analysis.detectedLanguage}
                </span>
              )}
              {analysis?.lastUpdated && <span className="text-[9px] text-slate-500">Análise: {analysis.lastUpdated}</span>}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onReanalyze}
          disabled={isLoading}
          title="Analisar o histórico completo novamente"
          className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {isLoading && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-emerald-400" />
          <p className="mt-2 text-xs font-semibold text-emerald-200">Lendo o histórico e preparando a melhor próxima ação...</p>
        </div>
      )}

      {!analysis && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-3">
          <div className="flex items-start gap-2">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div>
              <p className="text-xs font-bold text-slate-200">Ainda não há leitura do contexto</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">A análise identifica etapa, objeções e a ação mais segura. Você também pode criar uma resposta orientada abaixo.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onReanalyze}
            className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-500 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" /> Analisar conversa
          </button>
        </div>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${badgeStyle!.bg}`}>
              {BadgeIcon && <BadgeIcon className="h-4 w-4 shrink-0" />}
              <div className="min-w-0">
                <span className="block text-[9px] uppercase tracking-wide opacity-70">Etapa</span>
                <span className="block truncate text-xs font-bold">{analysis.leadStage}</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wide text-slate-500">Probabilidade</span>
                <span className="text-xs font-bold text-emerald-400">{analysis.dealProbability}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400" style={{ width: `${Math.min(100, Math.max(3, analysis.dealProbability))}%` }} />
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-950/35 to-slate-950 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              <Lightbulb className="h-3.5 w-3.5" /> Decisão para agora
            </div>
            <p className="mt-1.5 text-xs font-semibold leading-relaxed text-amber-50">{actionObjective}</p>
            <div className="mt-2 border-t border-amber-500/15 pt-2 text-[11px] leading-relaxed text-amber-100/75">
              <span className="font-bold text-amber-300">Por quê: </span>{actionReason}
            </div>
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-slate-700/70 bg-slate-950/60 p-2 text-[10px] leading-relaxed text-slate-400">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>{actionGuardrail}</span>
            </div>
          </section>
        </>
      )}

      <section className="rounded-xl border border-violet-500/25 bg-slate-950 p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
              <Wand2 className="h-3.5 w-3.5" /> Próxima mensagem
            </span>
            <p className="mt-0.5 text-[11px] text-slate-500">A resposta é um rascunho revisável; enviar continua sendo uma decisão explícita.</p>
          </div>
          {hasReadySuggestedReply && onGenerateReplyFromHint && (
            <button
              type="button"
              onClick={() => setShowHintComposer((value) => !value)}
              className="shrink-0 rounded-lg border border-violet-500/30 px-2 py-1 text-[10px] font-bold text-violet-300 hover:bg-violet-500/10 transition-colors cursor-pointer"
            >
              {showHintComposer ? 'Fechar ajuste' : 'Ajustar'}
            </button>
          )}
        </div>

        {hasReadySuggestedReply && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Rascunho recomendado</span>
              <button type="button" onClick={() => handleCopyReply(analysis!.suggestedSmartReply, 'analysis')} className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white cursor-pointer">
                <Copy className="h-3 w-3" /> {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-xs leading-relaxed text-slate-100">{analysis!.suggestedSmartReply}</p>
            {analysis!.suggestedSmartReplyTranslation && (
              <details className="rounded-lg border border-blue-500/20 bg-blue-950/20 px-2.5 py-2">
                <summary className="cursor-pointer text-[10px] font-bold text-blue-300">Ver tradução para revisão interna</summary>
                <p className="mt-1.5 text-[11px] leading-relaxed text-blue-100">{analysis!.suggestedSmartReplyTranslation}</p>
              </details>
            )}
            {renderReplyActions(analysis!.suggestedSmartReply, 'analysis')}
          </div>
        )}

        {onGenerateReplyFromHint && hintComposerOpen && (
          <div className={hasReadySuggestedReply ? 'border-t border-slate-800 pt-3 space-y-2.5' : 'space-y-2.5'}>
            <div className="flex flex-wrap gap-1.5">
              {HINT_SUGGESTIONS.map(({ label, hint }) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => setHintDraft(hint)}
                  title={hint}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-medium text-slate-300 hover:border-violet-500/45 hover:text-violet-200 transition-colors cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
            <AutoResizeTextarea
              value={hintDraft}
              onChange={(event) => setHintDraft(event.target.value)}
              placeholder="Descreva o objetivo da mensagem. Ex.: responda à dúvida sobre duração e depois pergunte qual dia ela prefere."
              minRows={3}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs leading-relaxed text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGenerateHintReply}
              disabled={!hintDraft.trim() || isGeneratingHintReply}
              className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isGeneratingHintReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {isGeneratingHintReply ? 'Criando rascunho...' : 'Criar resposta para revisão'}
            </button>
          </div>
        )}

        {hintReplyResult?.error && <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-2.5 text-xs text-rose-200">{hintReplyResult.error}</div>}

        {hintReplyResult?.reply && (
          <div className="rounded-xl border border-violet-500/25 bg-violet-950/15 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300">Rascunho com orientação</span>
              <button type="button" onClick={() => handleCopyReply(hintReplyResult.reply, 'hint')} className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white cursor-pointer">
                <Copy className="h-3 w-3" /> {hintReplyCopied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-xs leading-relaxed text-slate-100">{hintReplyResult.reply}</p>
            {hintReplyResult.translation && (
              <details className="rounded-lg border border-blue-500/20 bg-blue-950/20 px-2.5 py-2">
                <summary className="cursor-pointer text-[10px] font-bold text-blue-300">Ver tradução para revisão interna</summary>
                <p className="mt-1.5 text-[11px] leading-relaxed text-blue-100">{hintReplyResult.translation}</p>
              </details>
            )}
            {renderReplyActions(hintReplyResult.reply, 'hint')}
          </div>
        )}
      </section>

      {analysis && (
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/55">
          <button type="button" onClick={() => setShowContext((value) => !value)} className="flex w-full items-center justify-between p-3 text-left cursor-pointer">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"><FileText className="h-3.5 w-3.5" /> Contexto e sinais da conversa</span>
            {showContext ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          </button>
          {showContext && (
            <div className="space-y-3 border-t border-slate-800 p-3">
              <p className="text-xs leading-relaxed text-slate-300">{analysis.conversationSummary}</p>
              <div className="grid grid-cols-2 gap-2">
                <SignalCard icon={DollarSign} label="Orçamento" value={analysis.extractedCRMData?.budget || 'Não informado'} />
                <SignalCard icon={Clock} label="Decisão" value={analysis.extractedCRMData?.timeline || 'Não informada'} />
              </div>
              {analysis.extractedCRMData?.productsOfInterest?.length ? (
                <SignalCard icon={Target} label="Interesses" value={analysis.extractedCRMData.productsOfInterest.join(' · ')} tone="amber" />
              ) : null}
              {analysis.extractedCRMData?.keyObjections?.length ? (
                <SignalCard icon={AlertTriangle} label="Objeções" value={analysis.extractedCRMData.keyObjections.join(' · ')} tone="rose" />
              ) : null}
              {analysis.keyTopicsDiscussed?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keyTopicsDiscussed.map((topic) => <span key={topic} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">{topic}</span>)}
                </div>
              ) : null}
              {analysis.multiModalInsights?.length ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/15 p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300"><ImageIcon className="h-3 w-3" /> Mídias e documentos</span>
                  <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-emerald-100">
                    {analysis.multiModalInsights.map((insight) => <li key={insight}>• {insight}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      {onSendCAPIEvent && (
        <section className="overflow-hidden rounded-xl border border-blue-500/25 bg-slate-950/55">
          <button type="button" onClick={() => setShowCapiSection((value) => !value)} className="flex w-full items-center justify-between p-3 text-left cursor-pointer">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-300"><Send className="h-3.5 w-3.5" /> Evento Meta CAPI</span>
            {showCapiSection ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          </button>
          {showCapiSection && (
            <div className="grid grid-cols-2 gap-1.5 border-t border-blue-500/15 p-3">
              {([
                ['QualifiedLead', 'Qualificado'],
                ['Schedule', 'Agendamento'],
                ['PurchaseIntention', 'Intenção de compra'],
                ['Purchase', 'Venda fechada'],
              ] as const).map(([eventName, label]) => (
                <button key={eventName} type="button" onClick={() => onSendCAPIEvent(eventName)} className="rounded-lg border border-blue-500/20 bg-blue-950/25 px-2.5 py-2 text-left text-[10px] font-semibold text-blue-100 hover:bg-blue-950/50 transition-colors cursor-pointer">
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {onAskAi && (
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/45">
          <button type="button" onClick={() => setShowAskAiSection((value) => !value)} className="flex w-full items-center justify-between p-3 text-left cursor-pointer">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Bot className="h-3.5 w-3.5" /> Consultar IA sobre a conversa</span>
            {showAskAiSection ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          </button>
          {showAskAiSection && (
            <div className="space-y-2 border-t border-slate-800 p-3">
              <AutoResizeTextarea value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} minRows={2} placeholder="Ex.: qual é a principal objeção ainda aberta nesta conversa?" className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none" />
              <button type="button" onClick={handleAsk} disabled={!questionDraft.trim() || isAsking} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer">
                {isAsking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />} {isAsking ? 'Consultando...' : 'Perguntar'}
              </button>
              {askResult?.error && <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-2.5 text-xs text-rose-200">{askResult.error}</div>}
              {askResult?.answer && <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-xs leading-relaxed text-slate-100">{askResult.answer}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
