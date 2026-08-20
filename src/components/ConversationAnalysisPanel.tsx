import React from 'react';
import { FullConversationAnalysis } from '../types';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  Sparkles,
  TrendingUp,
  Target,
  AlertTriangle,
  DollarSign,
  Clock,
  ArrowRight,
  Copy,
  Send,
  FileText,
  RefreshCw,
  Flame,
  HelpCircle,
  AlertCircle,
  Lightbulb,
  Image as ImageIcon,
  Globe,
  Languages,
  Wand2,
  Bot,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

/** Resultado de POST /api/ai/reply-from-hint — ver handleGenerateReplyFromHint em WhatsAppLeadsSim.tsx. */
export interface HintReplyResult {
  reply: string;
  translation?: string;
  detectedLanguage?: string;
  error?: string;
}

/** Resultado de POST /api/ai/ask — ver handleAskAi em WhatsAppLeadsSim.tsx. */
export interface AskAiResult {
  answer: string;
  error?: string;
}

interface ConversationAnalysisPanelProps {
  analysis?: FullConversationAnalysis;
  isLoading: boolean;
  onReanalyze: () => void;
  onApplySuggestedReply?: (reply: string) => void;
  leadName: string;
  onSendCAPIEvent?: (eventName: 'Lead' | 'Contact' | 'QualifiedLead' | 'Schedule' | 'PurchaseIntention' | 'Purchase') => void;
  /** Pedido real (15/08/2026): "gerar resposta com sugestão, igual ao escalonamento, mas na hora" — o operador escreve uma instrução curta e a IA devolve uma mensagem pronta seguindo ela (usando o histórico só pra manter tom/idioma). */
  onGenerateReplyFromHint?: (hint: string) => Promise<HintReplyResult>;
  /** Pedido real (15/08/2026): assistente de perguntas livres — sobre a conversa OU perguntas gerais sem relação nenhuma com o lead. */
  onAskAi?: (question: string) => Promise<AskAiResult>;
}

/** Sugestões rápidas de orientação — atalhos pra não precisar digitar do zero (proposta UX 18/08/2026).
 * Trocadas por instruções de vendas mais estratégicas (pedido real, 20/08/2026): os rótulos genéricos
 * originais ("Mais curta", "Responder sobre instalação"...) eram um placeholder fixo, igual pra todo
 * tenant, e nem faziam sentido pra um estúdio de beleza. Cada item tem um `label` curto pro botão e um
 * `hint` completo — a instrução de verdade que vai pro campo de texto e é enviada à IA — porque um
 * rótulo de 2 palavras vira uma orientação fraca quando mandado cru como prompt. */
const HINT_SUGGESTIONS: Array<{ label: string; hint: string }> = [
  { label: 'CTA de fechamento', hint: 'Termine a mensagem com uma chamada clara pra fechar: convide a cliente a confirmar o horário/agendamento agora.' },
  { label: 'Follow-up (sumiu)', hint: 'A cliente parou de responder — manda um follow-up educado e leve perguntando se ainda tem interesse, sem soar cobrança.' },
  { label: 'Reaquecer lead frio', hint: 'Esse lead esfriou — reaqueça a conversa trazendo algo de valor (novidade, benefício, disponibilidade) sem parecer insistente.' },
  { label: 'Quebrar objeção de preço', hint: 'A cliente demonstrou objeção de preço — responda reforçando o valor/benefício do serviço, sem ficar na defensiva.' },
  { label: 'Criar urgência real', hint: 'Crie um senso de urgência genuíno (ex: poucos horários disponíveis) sem soar como pressão artificial.' },
  { label: 'Confirmar próximo passo', hint: 'Feche a mensagem deixando muito claro qual é o próximo passo combinado (o que a cliente precisa fazer/responder agora).' },
  { label: 'Mais persuasiva', hint: 'Reescreva de forma mais persuasiva, destacando benefícios e criando desejo, sem exagerar.' },
  { label: 'Mais curta', hint: 'Reescreva de forma bem mais curta e direta, mantendo o essencial.' },
];

export const ConversationAnalysisPanel: React.FC<ConversationAnalysisPanelProps> = ({
  analysis,
  isLoading,
  onReanalyze,
  onApplySuggestedReply,
  leadName,
  onSendCAPIEvent,
  onGenerateReplyFromHint,
  onAskAi,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopyReply = () => {
    if (analysis?.suggestedSmartReply) {
      navigator.clipboard.writeText(analysis.suggestedSmartReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Gerar Resposta a partir de uma Sugestão do operador — parte do bloco "Próxima Ação".
  const [hintDraft, setHintDraft] = React.useState('');
  const [isGeneratingHintReply, setIsGeneratingHintReply] = React.useState(false);
  const [hintReplyResult, setHintReplyResult] = React.useState<HintReplyResult | null>(null);
  const [hintReplyCopied, setHintReplyCopied] = React.useState(false);
  const [showHintComposer, setShowHintComposer] = React.useState(false);

  const handleGenerateHintReply = async () => {
    if (!hintDraft.trim() || !onGenerateReplyFromHint) return;
    setIsGeneratingHintReply(true);
    setHintReplyResult(null);
    try {
      const result = await onGenerateReplyFromHint(hintDraft.trim());
      setHintReplyResult(result);
    } catch (err: any) {
      setHintReplyResult({ reply: '', error: err.message || 'Falha ao gerar resposta.' });
    } finally {
      setIsGeneratingHintReply(false);
    }
  };

  const handleCopyHintReply = () => {
    if (hintReplyResult?.reply) {
      navigator.clipboard.writeText(hintReplyResult.reply);
      setHintReplyCopied(true);
      setTimeout(() => setHintReplyCopied(false), 2000);
    }
  };

  const applyHintSuggestion = (hint: string) => {
    setHintDraft(hint);
  };

  // Perguntar à IA — assistente de perguntas livres (sobre a conversa ou gerais). Independente da análise.
  const [questionDraft, setQuestionDraft] = React.useState('');
  const [isAsking, setIsAsking] = React.useState(false);
  const [askResult, setAskResult] = React.useState<AskAiResult | null>(null);
  // Seções recolhíveis (pedido real, 19/08/2026: painel ficava com muita coisa
  // sempre aberta na tela) — fechadas por padrão, mesmo padrão visual do botão
  // "Gerar nova resposta com orientação" (seta + clique no cabeçalho expande).
  const [showCapiSection, setShowCapiSection] = React.useState(false);
  const [showReadyReply, setShowReadyReply] = React.useState(false);
  const [showAskAiSection, setShowAskAiSection] = React.useState(false);

  const handleAsk = async () => {
    if (!questionDraft.trim() || !onAskAi) return;
    setIsAsking(true);
    setAskResult(null);
    try {
      const result = await onAskAi(questionDraft.trim());
      setAskResult(result);
    } catch (err: any) {
      setAskResult({ answer: '', error: err.message || 'Falha ao consultar a IA.' });
    } finally {
      setIsAsking(false);
    }
  };

  // Get stage color
  const getStageBadge = (stage: string) => {
    if (stage.includes('Fechamento') || stage.includes('Quente')) {
      return { bg: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300', icon: Flame };
    }
    if (stage.includes('Morno')) {
      return { bg: 'bg-amber-500/20 border-amber-500/50 text-amber-300', icon: TrendingUp };
    }
    if (stage.includes('Objeção') || stage.includes('Perdido')) {
      return { bg: 'bg-rose-500/20 border-rose-500/50 text-rose-300', icon: AlertCircle };
    }
    return { bg: 'bg-blue-500/20 border-blue-500/50 text-blue-300', icon: HelpCircle };
  };

  const badgeStyle = analysis ? getStageBadge(analysis.leadStage || '') : null;
  const BadgeIcon = badgeStyle?.icon;

  // A "Resposta Sugerida" da análise só é confiável quando não é fallback (Gemini indisponível gera suggestedSmartReply vazio de propósito).
  const hasReadySuggestedReply = !!analysis && analysis.source !== 'fallback' && !!analysis.suggestedSmartReply;
  // Sem sugestão pronta da análise, o composer de orientação passa a ser a própria ação principal — não faz sentido escondê-lo atrás de um clique.
  const hintComposerOpen = showHintComposer || !hasReadySuggestedReply;
  const showNextActionBlock = !!(onApplySuggestedReply || onGenerateReplyFromHint);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-5">
      {isLoading ? (
        /* Analisando — a análise contextual ainda não está pronta, mas as ferramentas abaixo (gerar resposta, perguntar à IA) continuam disponíveis. */
        <div className="text-center space-y-3 py-2 animate-pulse">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5 animate-spin text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Analisando Histórico Completo com Gemini IA...</h3>
            <p className="text-xs text-slate-400 mt-1">
              Sintetizando mídias, áudios, imagens e textos da conversa com {leadName}...
            </p>
          </div>
        </div>
      ) : !analysis ? (
        /* Nenhuma análise ainda — não bloqueia mais o restante do painel: gerar resposta e perguntar à IA seguem disponíveis abaixo. */
        <div className="bg-slate-900/80 border border-dashed border-slate-800 rounded-2xl p-4 text-center space-y-2.5">
          <Sparkles className="w-6 h-6 text-emerald-500/50 mx-auto" />
          <div>
            <h4 className="text-sm font-semibold text-slate-300">Nenhuma análise gerada ainda</h4>
            <p className="text-xs text-slate-500 mt-1">
              Analise o histórico para ver estágio no funil, probabilidade de venda e dados extraídos para CRM.
            </p>
          </div>
          <button
            onClick={onReanalyze}
            className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md cursor-pointer transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            <span>Analisar Conversa Completa</span>
          </button>
        </div>
      ) : (
        <>
          {/* Top Header & Re-analyze trigger */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Análise Contextual do Lead (IA)
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {analysis.lastUpdated && (
                    <span className="text-[10px] text-slate-500">
                      Atualizado às {analysis.lastUpdated}
                    </span>
                  )}
                  {analysis.source === 'fallback' && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold border border-rose-500/30 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Análise indisponível
                    </span>
                  )}
                  {analysis.detectedLanguage && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[9px] font-bold border border-blue-500/30 flex items-center gap-0.5">
                      <Globe className="w-2.5 h-2.5" />
                      {analysis.detectedLanguage}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={onReanalyze}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              title="Reanalisar histórico da conversa"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>

          {/* Stage & Deal Probability Meter — compactado (proposta UX 18/08/2026: menos altura, menos texto). */}
          <div className="grid grid-cols-2 gap-2">
            <div className={`px-2.5 py-2 rounded-xl border ${badgeStyle!.bg} flex items-center space-x-2`}>
              {BadgeIcon && <BadgeIcon className="w-4 h-4 flex-shrink-0" />}
              <span className="text-xs font-bold truncate">{analysis.leadStage}</span>
            </div>

            <div className="px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex-1">
                <div
                  className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(5, analysis.dealProbability))}%` }}
                />
              </div>
              <span className="font-bold text-emerald-400 text-xs whitespace-nowrap">{analysis.dealProbability}%</span>
            </div>
          </div>

          {/* Conversation Executive Summary */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center">
              <FileText className="w-3 h-3 mr-1 text-emerald-400" />
              Sintese Continuada do Diálogo
            </span>
            <p className="text-xs text-slate-300 leading-relaxed">
              {analysis.conversationSummary}
            </p>
          </div>

          {/* Extracted CRM Data Cards */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Dados Extraídos para CRM
            </span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 font-medium flex items-center mb-0.5">
                  <DollarSign className="w-3 h-3 mr-1 text-emerald-400" /> Orçamento
                </span>
                <span className="font-bold text-slate-200 block truncate">
                  {analysis.extractedCRMData?.budget || 'Não informado'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 font-medium flex items-center mb-0.5">
                  <Clock className="w-3 h-3 mr-1 text-blue-400" /> Prazo Decisão
                </span>
                <span className="font-bold text-slate-200 block truncate">
                  {analysis.extractedCRMData?.timeline || 'Não informado'}
                </span>
              </div>
            </div>

            {/* Products of interest */}
            {analysis.extractedCRMData?.productsOfInterest && analysis.extractedCRMData.productsOfInterest.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-500 font-medium flex items-center">
                  <Target className="w-3 h-3 mr-1 text-amber-400" /> Interesses Identificados
                </span>
                <div className="flex flex-wrap gap-1">
                  {analysis.extractedCRMData.productsOfInterest.map((item, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 text-[10px] font-medium border border-slate-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Key Objections */}
            {analysis.extractedCRMData?.keyObjections && analysis.extractedCRMData.keyObjections.length > 0 && (
              <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/50 space-y-1">
                <span className="text-[10px] text-rose-400 font-medium flex items-center">
                  <AlertTriangle className="w-3 h-3 mr-1 text-rose-400" /> Objeções a Resolver
                </span>
                <ul className="space-y-0.5 text-[11px] text-rose-200 list-disc list-inside">
                  {analysis.extractedCRMData.keyObjections.map((obj, idx) => (
                    <li key={idx}>{obj}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Multi-modal Media Insights (If images/files/audios were processed) */}
          {analysis.multiModalInsights && analysis.multiModalInsights.length > 0 && (
            <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center">
                <ImageIcon className="w-3.5 h-3.5 mr-1" /> Insights de Mídias e Documentos
              </span>
              <ul className="space-y-1 text-xs text-emerald-200">
                {analysis.multiModalInsights.map((insight, idx) => (
                  <li key={idx} className="flex items-start space-x-1.5">
                    <span className="text-emerald-400 mt-0.5">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended Next Action (contexto da análise) */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-amber-950/40 to-slate-950 border border-amber-500/30 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center">
              <Lightbulb className="w-3.5 h-3.5 mr-1" /> Próxima Melhor Ação
            </span>
            <p className="text-xs text-amber-100 font-medium">
              {analysis.recommendedNextAction}
            </p>
          </div>

        </>
      )}

      {/* Meta CAPI Quick Actions — pedido real (19/08/2026): não depende de
          nenhum dado da análise (só dispara os eventos), então fica fora do
          bloco condicionado a `analysis` — disponível mesmo antes de rodar
          "Analisar Conversa Completa". Recolhida por padrão. */}
      {onSendCAPIEvent && (
        <div className="rounded-xl bg-slate-950 border border-blue-500/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCapiSection((v) => !v)}
            className="w-full p-3 flex items-center justify-between cursor-pointer"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center">
              <Send className="w-3.5 h-3.5 mr-1" /> Disparar Evento Meta CAPI
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[9px] bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300">
                Otimizar Pixel
              </span>
              {showCapiSection ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </span>
          </button>

          {showCapiSection && (
            <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
              <button
                onClick={() => onSendCAPIEvent('QualifiedLead')}
                className="px-2.5 py-1.5 bg-blue-950/80 hover:bg-blue-900 text-blue-200 border border-blue-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between cursor-pointer"
              >
                <span>Qualificado</span>
                <span className="text-[9px] text-blue-400 font-bold">CAPI</span>
              </button>

              <button
                onClick={() => onSendCAPIEvent('Schedule')}
                className="px-2.5 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between cursor-pointer"
              >
                <span>Agendamento</span>
                <span className="text-[9px] text-emerald-400 font-bold">CAPI</span>
              </button>

              <button
                onClick={() => onSendCAPIEvent('PurchaseIntention')}
                className="px-2.5 py-1.5 bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between cursor-pointer"
              >
                <span>Orçamento</span>
                <span className="text-[9px] text-purple-400 font-bold">CAPI</span>
              </button>

              <button
                onClick={() => onSendCAPIEvent('Purchase')}
                className="px-2.5 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between cursor-pointer"
              >
                <span>Venda Fechada</span>
                <span className="text-[9px] text-amber-400 font-bold">CAPI</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* PRÓXIMA AÇÃO — bloco consolidado (proposta UX 18/08/2026): resposta sugerida pela análise (quando existe)
          é a ação primária de envio; "gerar nova resposta com orientação" é a ação secundária, que reaproveita
          o mesmo composer de hint. Disponível mesmo sem análise (POST /api/ai/reply-from-hint é independente). */}
      {showNextActionBlock && (
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
          <div
            className={`flex items-center justify-between ${hasReadySuggestedReply ? 'cursor-pointer' : ''}`}
            {...(hasReadySuggestedReply ? { onClick: () => setShowReadyReply((v) => !v), role: 'button', tabIndex: 0 } : {})}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center">
              <ArrowRight className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Próxima Ação
            </span>
            <span className="flex items-center gap-1.5">
              {analysis?.detectedLanguage && (
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30 flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  {analysis.detectedLanguage}
                </span>
              )}
              {hasReadySuggestedReply && (
                showReadyReply ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </span>
          </div>

          {/* Resposta recomendada pela IA (vinda da análise) — recolhida por padrão. */}
          {hasReadySuggestedReply && showReadyReply && (
            <>
              {analysis!.suggestedSmartReplyTranslation && (
                <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-500/30 space-y-1">
                  <div className="flex items-center justify-between text-blue-300 text-[11px] font-bold">
                    <span className="flex items-center gap-1">
                      <Languages className="w-3.5 h-3.5 text-blue-400" />
                      Tradução em Português (Para Análise do Atendente)
                    </span>
                    <span className="text-[9px] bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300">
                      Uso Interno
                    </span>
                  </div>
                  <p className="text-xs text-blue-100 leading-relaxed font-medium">
                    "{analysis!.suggestedSmartReplyTranslation}"
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-semibold flex items-center gap-1">
                    <span>Resposta recomendada pela IA:</span>
                    <span className="text-emerald-400 font-bold">
                      ({analysis!.detectedLanguage || 'Português'})
                    </span>
                  </span>
                  <button
                    onClick={handleCopyReply}
                    className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                </div>

                <p className="text-xs text-slate-100 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 leading-relaxed italic whitespace-pre-wrap">
                  "{analysis!.suggestedSmartReply}"
                </p>
              </div>

              {onApplySuggestedReply && (
                <button
                  onClick={() => onApplySuggestedReply(analysis!.suggestedSmartReply)}
                  className="w-full py-2.5 px-3 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center space-x-1.5 shadow-md transition-all cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar resposta no WhatsApp</span>
                </button>
              )}

              {onGenerateReplyFromHint && (
                <button
                  onClick={() => setShowHintComposer((v) => !v)}
                  className="w-full py-1.5 px-3 rounded-lg text-[11px] font-semibold bg-transparent hover:bg-slate-900 text-violet-300 border border-violet-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Gerar nova resposta com orientação</span>
                  {showHintComposer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}
            </>
          )}

          {/* Composer de orientação — sempre aberto quando não há resposta pronta da análise (é a ação principal nesse caso). */}
          {onGenerateReplyFromHint && hintComposerOpen && (
            <div className={hasReadySuggestedReply ? 'pt-2 border-t border-slate-800 space-y-2.5' : 'space-y-2.5'}>
              {!hasReadySuggestedReply && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 flex items-center">
                  <Wand2 className="w-3.5 h-3.5 mr-1" /> Gerar Resposta com Orientação
                </span>
              )}
              <div className="flex flex-wrap gap-1.5">
                {HINT_SUGGESTIONS.map(({ label, hint }) => (
                  <button
                    key={label}
                    onClick={() => applyHintSuggestion(hint)}
                    title={hint}
                    className="px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-violet-300 border border-violet-500/30 text-[10px] font-medium transition-all cursor-pointer"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <AutoResizeTextarea
                value={hintDraft}
                onChange={(e) => setHintDraft(e.target.value)}
                placeholder='Ex: "diz pra ela que sábado às 14h ainda tá livre" ou "explica que o valor já inclui instalação"'
                minRows={2}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                onClick={handleGenerateHintReply}
                disabled={!hintDraft.trim() || isGeneratingHintReply}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {isGeneratingHintReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{isGeneratingHintReply ? 'Gerando...' : 'Gerar Resposta'}</span>
              </button>

              {hintReplyResult?.error && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
                  {hintReplyResult.error}
                </div>
              )}

              {hintReplyResult?.reply && (
                <>
                  {hintReplyResult.translation && (
                    <div className="p-2.5 rounded-lg bg-blue-950/40 border border-blue-500/30 space-y-1">
                      <span className="flex items-center gap-1 text-blue-300 text-[11px] font-bold">
                        <Languages className="w-3.5 h-3.5 text-blue-400" />
                        Tradução em Português
                      </span>
                      <p className="text-xs text-blue-100 leading-relaxed">"{hintReplyResult.translation}"</p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-semibold flex items-center gap-1">
                        <span>Mensagem Pronta para Envio:</span>
                        {hintReplyResult.detectedLanguage && (
                          <span className="text-violet-400 font-bold">({hintReplyResult.detectedLanguage})</span>
                        )}
                      </span>
                      <button onClick={handleCopyHintReply} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer">
                        <Copy className="w-3 h-3" />
                        <span>{hintReplyCopied ? 'Copiado!' : 'Copiar'}</span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-100 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 leading-relaxed italic whitespace-pre-wrap">
                      "{hintReplyResult.reply}"
                    </p>
                  </div>

                  {onApplySuggestedReply && (
                    <button
                      onClick={() => onApplySuggestedReply(hintReplyResult.reply)}
                      className="w-full py-2.5 px-3 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center space-x-1.5 shadow-md transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Enviar resposta no WhatsApp</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* PERGUNTAR À IA — assistente exploratório, deliberadamente secundário ao bloco de ação acima.
          Independente da análise (POST /api/ai/ask), disponível mesmo sem "Analisar Conversa Completa". */}
      {onAskAi && (
        <div className="rounded-xl bg-slate-950/60 border border-slate-800/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAskAiSection((v) => !v)}
            className="w-full p-3 flex items-center justify-between cursor-pointer"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center">
              <Bot className="w-3.5 h-3.5 mr-1 text-slate-500" /> Assistente IA
            </span>
            {showAskAiSection ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
          </button>

          {showAskAiSection && (
            <div className="px-3 pb-3 space-y-2">
              <AutoResizeTextarea
                value={questionDraft}
                onChange={(e) => setQuestionDraft(e.target.value)}
                placeholder='Sobre esta conversa ("esse cliente já falou de orçamento?") ou qualquer pergunta geral ("traduza esta frase", "quais feriados tem este mês")'
                minRows={2}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-slate-600"
              />
              <button
                onClick={handleAsk}
                disabled={!questionDraft.trim() || isAsking}
                className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                {isAsking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                <span>{isAsking ? 'Perguntando...' : 'Perguntar'}</span>
              </button>

              {askResult?.error && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
                  {askResult.error}
                </div>
              )}

              {askResult?.answer && (
                <p className="text-xs text-slate-100 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 leading-relaxed whitespace-pre-wrap">
                  {askResult.answer}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
