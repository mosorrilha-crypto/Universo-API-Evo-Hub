import React from 'react';
import { CalendarPlus } from 'lucide-react';
import { AutoResizeTextarea } from '../AutoResizeTextarea';

interface ManualAppointmentModalProps {
  isOpen: boolean;
  leadName?: string;
  leadPhone?: string;
  products: Array<{ id: string; name: string }>;
  serviceName: string;
  onServiceNameChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  time: string;
  onTimeChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  paymentReceived: boolean;
  onPaymentReceivedChange: (value: boolean) => void;
  error: string | null;
  isCreating: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const ManualAppointmentModal: React.FC<ManualAppointmentModalProps> = ({
  isOpen, leadName, leadPhone, products, serviceName, onServiceNameChange, date, onDateChange, time, onTimeChange, notes, onNotesChange, paymentReceived, onPaymentReceivedChange, error, isCreating, onSubmit, onClose,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <CalendarPlus className="w-5 h-5 text-emerald-400" />
          Cadastrar agendamento manual
        </h3>
        <p className="text-xs text-slate-400">
          Pra um horário combinado fora do WhatsApp (telefone, presencial). Cria o evento real na agenda e ativa o lembrete automático — não conta como venda vinda de anúncio.
        </p>

        {/* Achado real: este modal sempre foi aberto de dentro de uma
            conversa já selecionada (o operador via o nome no cabeçalho por
            trás) — sem indicação nenhuma de "pra quem" dentro do próprio
            modal. Ficou confuso quando o widget de agenda (#209) passou a
            abrir este mesmo modal fora do contexto de uma conversa. */}
        {leadName || leadPhone ? (
          <div className="bg-slate-950 border border-emerald-800/40 rounded-xl p-2.5 text-xs">
            <span className="text-slate-500">Agendamento para: </span>
            <span className="text-emerald-300 font-semibold">{leadName || leadPhone}</span>
            {leadName && leadPhone && <span className="text-slate-500"> · {leadPhone}</span>}
          </div>
        ) : (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">
            Nenhum contato selecionado — feche e escolha um contato antes de cadastrar.
          </div>
        )}

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{error}</div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Serviço *</label>
            <select
              required
              value={serviceName}
              onChange={(e) => onServiceNameChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Selecione...</option>
              {products.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Data *</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Horário *</label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => onTimeChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Descrição (opcional)</label>
            <AutoResizeTextarea
              minRows={3}
              placeholder="Ex: cliente pediu pra confirmar o endereço antes, quer levar acompanhante..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={paymentReceived}
              onChange={(e) => onPaymentReceivedChange(e.target.checked)}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs text-slate-300">Comprovante de pagamento já recebido (marca como verificado)</span>
          </label>

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
              disabled={isCreating || (!leadName && !leadPhone)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md shadow-emerald-950 flex items-center space-x-1 cursor-pointer"
            >
              <CalendarPlus className="w-3.5 h-3.5 mr-1" />
              <span>{isCreating ? 'Cadastrando...' : 'Cadastrar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
