import React from 'react';
import { PlusCircle, Send } from 'lucide-react';
import { AutoResizeTextarea } from '../AutoResizeTextarea';

interface AddLeadModalProps {
  isOpen: boolean;
  name: string;
  onNameChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  text: string;
  onTextChange: (value: string) => void;
  isGenerating: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({
  isOpen, name, onNameChange, phone, onPhoneChange, text, onTextChange, isGenerating, onSubmit, onClose,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-emerald-400" />
          Simular Novo Lead no WhatsApp
        </h3>
        <p className="text-xs text-slate-400">
          Crie uma nova conversa simulada para testar a inteligência contínua do Gemini.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Nome do Lead *</label>
            <input
              type="text"
              required
              placeholder="Ex: Mariana Costa"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Telefone / WhatsApp</label>
            <input
              type="text"
              placeholder="Ex: +55 (11) 99887-6655"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Primeira Mensagem do Cliente *</label>
            <AutoResizeTextarea
              required
              minRows={3}
              placeholder="Ex: Olá, gostaria de solicitar um orçamento para o plano enterprise..."
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-950 flex items-center space-x-1 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              <span>Criar Lead e Analisar</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
