import React, { useState } from 'react';
import { SavedTranscriptItem } from '../types';
import { Search, Download, Trash2, Mic, Upload, MessageSquare, Tag, FileText, Calendar, Check, ExternalLink } from 'lucide-react';
import { TranscriptionCard } from './TranscriptionCard';

interface TranscriptHistoryProps {
  items?: SavedTranscriptItem[];
  onClearHistory?: () => void;
  onDeleteItem?: (id: string) => void;
}

export const TranscriptHistory: React.FC<TranscriptHistoryProps> = ({
  items = [],
  onClearHistory,
  onDeleteItem,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<SavedTranscriptItem | null>(null);

  const filteredItems = (items || []).filter((item) => {
    const matchSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.leadName && item.leadName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      item.result.transcription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.result.summary.toLowerCase().includes(searchTerm.toLowerCase());

    const matchSentiment =
      sentimentFilter === 'all' ||
      item.result.sentiment.toLowerCase().includes(sentimentFilter.toLowerCase());

    return matchSearch && matchSentiment;
  });

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `transcricoes_whatsapp_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Data', 'Origem', 'Lead', 'Sentimento', 'Urgência', 'Transcrição', 'Resumo', 'Resposta_Sugerida'];
    const rows = items.map((i) => [
      i.id,
      `"${i.createdAt}"`,
      `"${i.source}"`,
      `"${i.leadName || ''}"`,
      `"${i.result.sentiment}"`,
      i.result.urgencyScore || 3,
      `"${i.result.transcription.replace(/"/g, '""')}"`,
      `"${i.result.summary.replace(/"/g, '""')}"`,
      `"${i.result.suggestedReply.replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `transcricoes_leads_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'microphone':
        return <Mic className="w-3.5 h-3.5 text-emerald-400" />;
      case 'file_upload':
        return <Upload className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Search and Filters Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Search Bar */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por lead, texto ou resumo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Sentiment Filter */}
        <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto">
          <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Filtro:</span>
          {['all', 'positivo', 'urgente', 'dúvida', 'objeção'].map((filterKey) => (
            <button
              key={filterKey}
              onClick={() => setSentimentFilter(filterKey)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all ${
                sentimentFilter === filterKey
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {filterKey === 'all' ? 'Todos' : filterKey}
            </button>
          ))}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
          {items.length > 0 && (
            <>
              <button
                onClick={handleExportCSV}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 flex items-center"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                CSV
              </button>

              <button
                onClick={handleExportJSON}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 flex items-center"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                JSON
              </button>

              <button
                onClick={onClearHistory}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 border border-slate-800"
                title="Limpar histórico"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-12 text-center">
          <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Nenhuma transcrição encontrada</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Grave um áudio com o microfone, faça upload de um arquivo ou selecione um lead do WhatsApp para salvar no histórico.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-5 transition-all cursor-pointer shadow-lg flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="flex items-center text-[11px] font-semibold text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                    <span className="mr-1.5">{getSourceIcon(item.source)}</span>
                    {item.source === 'microphone'
                      ? 'Microfone'
                      : item.source === 'file_upload'
                      ? 'Arquivo Upload'
                      : 'WhatsApp Lead'}
                  </span>

                  <span className="text-[10px] text-slate-500 flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {item.createdAt}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors line-clamp-1 mb-1">
                  {item.title}
                </h4>

                <p className="text-xs text-slate-300 line-clamp-3 mb-4 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 italic">
                  "{item.result.transcription}"
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                  {item.result.sentiment}
                </span>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteItem(item.id);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center">
                {selectedItem.title}
              </h3>
              <button
                onClick={() => setSelectedItem(null)}
                className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Fechar
              </button>
            </div>

            <TranscriptionCard
              result={selectedItem.result}
              audioUrl={selectedItem.audioUrl}
              leadName={selectedItem.leadName}
              leadPhone={selectedItem.leadPhone}
            />
          </div>
        </div>
      )}
    </div>
  );
};
