import React from 'react';
import { FullConversationAnalysis } from '../types';
import { 
  Sparkles, 
  TrendingUp, 
  Target, 
  AlertTriangle, 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  ArrowRight, 
  Copy, 
  Send, 
  FileText, 
  RefreshCw, 
  Flame, 
  Smile, 
  HelpCircle, 
  AlertCircle,
  Lightbulb,
  Image as ImageIcon,
  Globe,
  Languages
} from 'lucide-react';

interface ConversationAnalysisPanelProps {
  analysis?: FullConversationAnalysis;
  isLoading: boolean;
  onReanalyze: () => void;
  onApplySuggestedReply?: (reply: string) => void;
  leadName: string;
  onSendCAPIEvent?: (eventName: 'Lead' | 'Contact' | 'QualifiedLead' | 'Schedule' | 'PurchaseIntention' | 'Purchase') => void;
}

export const ConversationAnalysisPanel: React.FC<ConversationAnalysisPanelProps> = ({
  analysis,
  isLoading,
  onReanalyze,
  onApplySuggestedReply,
  leadName,
  onSendCAPIEvent,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopyReply = () => {
    if (analysis?.suggestedSmartReply) {
      navigator.clipboard.writeText(analysis.suggestedSmartReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-center space-y-4 animate-pulse">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Analisando Histórico Completo com Gemini IA...</h3>
          <p className="text-xs text-slate-400 mt-1">
            Sintetizando mídias, áudios, imagens e textos da conversa com {leadName}...
          </p>
        </div>
        <div className="space-y-2 pt-2">
          <div className="h-4 bg-slate-800 rounded w-3/4 mx-auto" />
          <div className="h-4 bg-slate-800 rounded w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="bg-slate-900/80 border border-dashed border-slate-800 rounded-2xl p-6 text-center space-y-3">
        <Sparkles className="w-8 h-8 text-emerald-500/50 mx-auto" />
        <div>
          <h4 className="text-sm font-semibold text-slate-300">Nenhuma análise gerada ainda</h4>
          <p className="text-xs text-slate-500 mt-1">
            Clique no botão abaixo para analisar todas as mensagens e mídias trocadas com este lead.
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
    );
  }

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

  const badgeStyle = getStageBadge(analysis.leadStage || '');
  const BadgeIcon = badgeStyle.icon;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-5">
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

      {/* Stage & Deal Probability Meter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Stage Badge */}
        <div className={`p-3 rounded-xl border ${badgeStyle.bg} flex items-center space-x-3`}>
          <BadgeIcon className="w-6 h-6 flex-shrink-0" />
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider block opacity-80">
              Estágio no Funil
            </span>
            <span className="text-xs font-bold">{analysis.leadStage}</span>
          </div>
        </div>

        {/* Probability Meter */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Probabilidade de Venda</span>
            <span className="font-bold text-emerald-400">{analysis.dealProbability}%</span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(5, analysis.dealProbability))}%` }}
            />
          </div>
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

      {/* Recommended Next Action */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-amber-950/40 to-slate-950 border border-amber-500/30 space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center">
          <Lightbulb className="w-3.5 h-3.5 mr-1" /> Próxima Melhor Ação
        </span>
        <p className="text-xs text-amber-100 font-medium">
          {analysis.recommendedNextAction}
        </p>
      </div>

      {/* Meta CAPI Quick Actions */}
      {onSendCAPIEvent && (
        <div className="p-3 rounded-xl bg-slate-950 border border-blue-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center">
              <Send className="w-3.5 h-3.5 mr-1" /> Disparar Evento Meta CAPI
            </span>
            <span className="text-[9px] bg-blue-500/20 px-1.5 py-0.2 rounded text-blue-300">
              Otimizar Pixel
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              onClick={() => onSendCAPIEvent('QualifiedLead')}
              className="px-2.5 py-1.5 bg-blue-950/80 hover:bg-blue-900 text-blue-200 border border-blue-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between"
            >
              <span>Qualificado</span>
              <span className="text-[9px] text-blue-400 font-bold">CAPI</span>
            </button>

            <button
              onClick={() => onSendCAPIEvent('Schedule')}
              className="px-2.5 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between"
            >
              <span>Agendamento</span>
              <span className="text-[9px] text-emerald-400 font-bold">CAPI</span>
            </button>

            <button
              onClick={() => onSendCAPIEvent('PurchaseIntention')}
              className="px-2.5 py-1.5 bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between"
            >
              <span>Orçamento</span>
              <span className="text-[9px] text-purple-400 font-bold">CAPI</span>
            </button>

            <button
              onClick={() => onSendCAPIEvent('Purchase')}
              className="px-2.5 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-800 rounded-lg text-[11px] font-medium transition-all text-left flex items-center justify-between"
            >
              <span>Venda Fechada</span>
              <span className="text-[9px] text-amber-400 font-bold">CAPI</span>
            </button>
          </div>
        </div>
      )}

      {/* AI Suggested Response Box */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center">
            <Sparkles className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Resposta Sugerida para WhatsApp
          </span>
          {analysis.detectedLanguage && (
            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30 flex items-center gap-1">
              <Globe className="w-3 h-3" />
              {analysis.detectedLanguage}
            </span>
          )}
        </div>

        {/* 1. Tradução/Significado em Português para o Atendente (Análise Prévia) */}
        {analysis.suggestedSmartReplyTranslation ? (
          <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-500/30 space-y-1">
            <div className="flex items-center justify-between text-blue-300 text-[11px] font-bold">
              <span className="flex items-center gap-1">
                <Languages className="w-3.5 h-3.5 text-blue-400" />
                Tradução em Português (Para Análise do Atendente)
              </span>
              <span className="text-[9px] bg-blue-500/20 px-1.5 py-0.2 rounded text-blue-300">
                Uso Interno
              </span>
            </div>
            <p className="text-xs text-blue-100 leading-relaxed font-medium">
              "{analysis.suggestedSmartReplyTranslation}"
            </p>
          </div>
        ) : analysis.detectedLanguage && !analysis.detectedLanguage.toLowerCase().includes('português') ? (
          <div className="p-2.5 rounded-lg bg-blue-950/30 border border-blue-500/20 text-blue-200 text-xs flex items-start gap-2">
            <Languages className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-[11px]">Tradução em Português:</span>
              <span className="text-[11px] opacity-90">
                A IA elaborou uma resposta no idioma do lead ({analysis.detectedLanguage}). Ao reanalisar, a tradução completa em Português aparecerá aqui para sua aprovação prévia.
              </span>
            </div>
          </div>
        ) : null}

        {/* 2. Mensagem Original Pronta no Idioma do Lead para Envio no WhatsApp */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-semibold flex items-center gap-1">
              <span>Mensagem Pronta para Envio:</span>
              <span className="text-emerald-400 font-bold">
                ({analysis.detectedLanguage || 'Português'})
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
            "{analysis.suggestedSmartReply}"
          </p>
        </div>

        {onApplySuggestedReply && (
          <button
            onClick={() => onApplySuggestedReply(analysis.suggestedSmartReply)}
            className="w-full py-2 px-3 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center space-x-1.5 shadow-md transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar esta resposta no Chat do WhatsApp</span>
          </button>
        )}
      </div>
    </div>
  );
};
