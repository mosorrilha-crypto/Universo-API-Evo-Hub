import React from 'react';
import { LeadInfo, ChatMessage } from '../../types';
import { Forward, X } from 'lucide-react';

interface ForwardMessageModalProps {
  message: ChatMessage | null;
  leads: LeadInfo[];
  excludeLeadId?: string;
  onForward: (toLead: LeadInfo) => void;
  onClose: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({ message, leads, excludeLeadId, onForward, onClose }) => {
  if (!message) return null;
  const candidates = leads.filter((l) => l.id !== excludeLeadId);
  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-sm w-full shadow-2xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Forward className="w-4 h-4 text-emerald-400" />
            Encaminhar mensagem
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-slate-400 truncate">"{message.text || 'Mídia'}"</p>
        <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
          {candidates.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">Nenhum outro contato disponível.</p>
          )}
          {candidates.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onForward(l)}
              className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 text-left transition-colors cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                {l.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{l.name}</div>
                <div className="text-[10px] text-slate-500 truncate">{l.phone}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
