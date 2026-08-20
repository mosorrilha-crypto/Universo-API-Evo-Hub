import React, { useState } from 'react';
import { CalendarPlus, Sparkles, Loader2, Pencil } from 'lucide-react';
import { AutoResizeTextarea } from '../AutoResizeTextarea';

interface ManualAppointmentModalProps {
  isOpen: boolean;
  leadName?: string;
  leadPhone?: string;
  products: Array<{ id: string; name: string }>;
  serviceName: string;
  onServiceNameChange: (value: string) => void;
  /** Serviço avulso criado só pra este agendamento (nunca entra na Base de Conhecimento) — pedido real (19/08/2026): um horário/procedimento combinado especialmente com um cliente (ex: preço/serviço fora do catálogo padrão) precisava de um jeito de agendar sem sujar o catálogo geral que a IA usa com todo mundo. */
  isCustomService: boolean;
  onIsCustomServiceChange: (value: boolean) => void;
  customDurationMinutes: string;
  onCustomDurationMinutesChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  time: string;
  onTimeChange: (value: string) => void;
  /** Horários REALMENTE livres pra essa data+duração ("HH:mm"), mesma fonte que a IA usa — pedido real (20/08/2026): auditar visualmente o que a IA enxerga como disponível, em vez de digitar hora "no escuro" e só descobrir conflito depois de salvar. Vazio = ainda não deu pra calcular (sem data/serviço, carregando, ou erro) — cai pro campo de digitar manualmente. */
  freeSlots: string[];
  isLoadingFreeSlots: boolean;
  freeSlotsError: string | null;
  notes: string;
  onNotesChange: (value: string) => void;
  paymentReceived: boolean;
  onPaymentReceivedChange: (value: boolean) => void;
  /** Valor REAL recebido, como texto do input (vazio = usa o preço do catálogo, comportamento de sempre) — pedido real (20/08/2026): "a cliente enviar um valor diferente dos 50.000 guaranis" precisa refletir no financeiro. */
  paymentAmountReceived: string;
  onPaymentAmountReceivedChange: (value: string) => void;
  error: string | null;
  isCreating: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const ManualAppointmentModal: React.FC<ManualAppointmentModalProps> = ({
  isOpen, leadName, leadPhone, products, serviceName, onServiceNameChange, isCustomService, onIsCustomServiceChange, customDurationMinutes, onCustomDurationMinutesChange, date, onDateChange, time, onTimeChange, freeSlots, isLoadingFreeSlots, freeSlotsError, notes, onNotesChange, paymentReceived, onPaymentReceivedChange, paymentAmountReceived, onPaymentAmountReceivedChange, error, isCreating, onSubmit, onClose,
}) => {
  // Mesmo quando os horários livres carregam certinho, o operador às vezes
  // precisa digitar um horário fora da amostra (exceção combinada com a
  // cliente) — o toggle mantém os botões como padrão (evita conflito por
  // engano) mas nunca bloqueia o caminho manual.
  const [isTypingTimeManually, setIsTypingTimeManually] = useState(false);
  if (!isOpen) return null;
  const showSlotPicker = !isTypingTimeManually && (isLoadingFreeSlots || freeSlots.length > 0);
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300">Serviço *</label>
              <button
                type="button"
                onClick={() => { onIsCustomServiceChange(!isCustomService); onServiceNameChange(''); }}
                className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isCustomService ? 'Usar serviço do catálogo' : 'Serviço personalizado'}</span>
              </button>
            </div>

            {isCustomService ? (
              <div className="space-y-2">
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ex: Pacote personalizado combinado com a cliente"
                  value={serviceName}
                  onChange={(e) => onServiceNameChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Duração (minutos) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 90"
                    value={customDurationMinutes}
                    onChange={(e) => onCustomDurationMinutesChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Criado só pra este agendamento — não entra na Base de Conhecimento nem fica disponível pra IA oferecer a outros clientes.
                </p>
              </div>
            ) : (
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
            )}
          </div>

          <div className={showSlotPicker ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Data *</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => { onDateChange(e.target.value); setIsTypingTimeManually(false); }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            {!showSlotPicker && (
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
            )}
          </div>

          {showSlotPicker && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">Horário *</label>
                <button
                  type="button"
                  onClick={() => setIsTypingTimeManually(true)}
                  className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Digitar outro horário</span>
                </button>
              </div>
              {isLoadingFreeSlots ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Consultando horários livres na agenda...</span>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {freeSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => onTimeChange(slot)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        time === slot ? 'bg-emerald-600 text-white' : 'bg-slate-950 border border-slate-800 text-slate-300 hover:border-emerald-600 hover:text-emerald-300'
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1.5">
                Mostrando só os horários realmente livres na agenda pra esse dia e duração — os mesmos que a IA enxerga.
              </p>
            </div>
          )}

          {!showSlotPicker && freeSlotsError && (
            <p className="text-[11px] text-amber-400">
              Não deu pra carregar os horários livres ({freeSlotsError}) — digite o horário manualmente.
            </p>
          )}

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

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={paymentReceived}
                onChange={(e) => { onPaymentReceivedChange(e.target.checked); if (!e.target.checked) onPaymentAmountReceivedChange(''); }}
                className="w-4 h-4 accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs text-slate-300">Comprovante de pagamento já recebido (marca como verificado)</span>
            </label>
            {!paymentReceived && (
              <p className="text-[11px] text-slate-500 pl-6">
                Deixe desmarcado pra agendar sem seña/comprovante ainda — o horário fica reservado do mesmo jeito, só sem pagamento verificado.
              </p>
            )}
            {paymentReceived && (
              <div className="pl-6">
                <label className="text-[11px] font-medium text-slate-400 block mb-1">Valor recebido (opcional — só se for diferente do preço do catálogo)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Ex: 50000"
                  value={paymentAmountReceived}
                  onChange={(e) => onPaymentAmountReceivedChange(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Em branco = usa o preço do catálogo no Financeiro. Preencha quando a cliente transferiu um valor diferente do combinado.
                </p>
              </div>
            )}
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
