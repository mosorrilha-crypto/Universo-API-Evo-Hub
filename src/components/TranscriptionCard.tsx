import React, { useState } from 'react';
import { TranscriptionResult } from '../types';
import { Copy, Check, Sparkles, MessageSquare, AlertCircle, FileText, Send, Zap, ThumbsUp, Tag } from 'lucide-react';

interface TranscriptionCardProps {
  result: TranscriptionResult;
  audioUrl?: string;
  title?: string;
  leadName?: string;
  leadPhone?: string;
  onCopyReply?: () => void;
}

export const TranscriptionCard: React.FC<TranscriptionCardProps> = ({
  result,
  audioUrl,
  title,
  leadName,
  leadPhone,
  onCopyReply,
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);

  const handleCopyTranscription = () => {
    navigator.clipboard.writeText(result.transcription);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopySuggestedReply = () => {
    navigator.clipboard.writeText(result.suggestedReply);
    setCopiedReply(true);
    if (onCopyReply) onCopyReply();
    setTimeout(() => setCopiedReply(false), 2000);
  };

  const getSentimentBadge = (sentiment: string) => {
    const s = sentiment.toLowerCase();
    if (s.includes('positivo') || s.includes('satisfeito')) {
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    }
    if (s.includes('urgente') || s.includes('alta')) {
      return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    }
    if (s.includes('dúvida') || s.includes('duvida') || s.includes('pergunta')) {
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    }
    if (s.includes('objeção') || s.includes('objecao') || s.includes('reclamacao')) {
      return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    }
    return 'bg-slate-700/50 text-slate-300 border-slate-600';
  };

  return (
    <div className="bg-slate-800/90 rounded-2xl border border-slate-700/80 shadow-xl overflow-hidden transition-all">
      {/* Top Banner */}
      <div className="bg-slate-900/80 px-6 py-4 border-b border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              {title || 'Transcrição e Análise Concluídas'}
            </h3>
            {leadName && (
              <p className="text-xs text-slate-400">
                Lead: <span className="text-slate-200 font-medium">{leadName}</span> ({leadPhone || 'WhatsApp'})
              </p>
            )}
          </div>
        </div>

        {/* Sentiment & Urgency badges */}
        <div className="flex items-center space-x-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center space-x-1 ${getSentimentBadge(
              result.sentiment
            )}`}
          >
            <Tag className="w-3 h-3 mr-1" />
            <span>{result.sentiment}</span>
          </span>

          {result.urgencyScore && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-950 text-amber-400 border border-amber-500/30 flex items-center">
              <Zap className="w-3 h-3 mr-1 text-amber-400" />
              Urgência: {result.urgencyScore}/5
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Audio Player if available */}
        {audioUrl && (
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-400 flex items-center">
              <FileText className="w-4 h-4 mr-1.5 text-emerald-400" />
              Áudio de Origem:
            </span>
            <audio controls src={audioUrl} className="w-full sm:w-80 h-9 rounded-lg" />
          </div>
        )}

        {/* Transcrição Integral */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center">
              <FileText className="w-4 h-4 mr-1.5 text-emerald-400" />
              Transcrição do Áudio
            </label>
            <button
              onClick={handleCopyTranscription}
              className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-700/70 hover:bg-slate-700 text-slate-200 hover:text-white transition-colors border border-slate-600"
            >
              {copiedText ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                  <span>Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  <span>Copiar Transcrição</span>
                </>
              )}
            </button>
          </div>
          <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-700/80 text-slate-100 text-sm leading-relaxed whitespace-pre-wrap font-sans select-text">
            "{result.transcription}"
          </div>
        </div>

        {/* Resumo e Intenção Comercial */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/60">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center mb-1.5">
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
              Resumo do Áudio
            </span>
            <p className="text-xs text-slate-200 leading-relaxed">{result.summary}</p>
          </div>

          <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/60">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center mb-1.5">
              <AlertCircle className="w-3.5 h-3.5 mr-1.5 text-sky-400" />
              Intenção Comercial
            </span>
            <p className="text-xs text-slate-200 font-semibold">{result.intent}</p>
          </div>
        </div>

        {/* Pontos Chave */}
        {result.keyPoints && result.keyPoints.length > 0 && (
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center mb-2">
              <ThumbsUp className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
              Pontos Principais Citados pelo Lead
            </span>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {result.keyPoints.map((point, idx) => (
                <li
                  key={idx}
                  className="flex items-start text-xs text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 mr-2 flex-shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sugestão de Resposta Rápida para o WhatsApp */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border border-emerald-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                Sugestão de Resposta para WhatsApp
              </span>
            </div>
            <button
              onClick={handleCopySuggestedReply}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950 transition-all"
            >
              {copiedReply ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1 text-white" />
                  <span>Copiado!</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 mr-1" />
                  <span>Copiar Resposta</span>
                </>
              )}
            </button>
          </div>
          <p className="p-3 bg-slate-950/80 rounded-lg text-xs text-emerald-100 leading-relaxed font-sans border border-emerald-900/50 select-text">
            {result.suggestedReply}
          </p>
        </div>
      </div>
    </div>
  );
};
