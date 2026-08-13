import React, { useState } from 'react';
import { LeadInfo } from '../../types';
import { Calendar as CalendarIcon, X, Loader2, RefreshCw, PlusCircle, Search } from 'lucide-react';

export interface UpcomingEvent {
  id: string;
  summary: string;
  startIso: string;
  description?: string;
}

interface UpcomingEventsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  events: UpcomingEvent[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  leads: LeadInfo[];
  onPickLeadForNewAppointment: (lead: LeadInfo) => void;
}

/** "Hoje" / "Amanhã" / dia da semana curto + data — só pra exibição, não precisa da mesma precisão de fuso do backend (que já resolve tudo antes de mandar o horário). */
function dayLabel(startIso: string): string {
  const eventDate = new Date(startIso);
  const today = new Date();
  const diffDays = Math.round(
    (new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Amanhã';
  return eventDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function timeLabel(startIso: string): string {
  return new Date(startIso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const UpcomingEventsPanel: React.FC<UpcomingEventsPanelProps> = ({
  isOpen, onClose, events, isLoading, error, onRefresh, leads, onPickLeadForNewAppointment,
}) => {
  const [isPickingLead, setIsPickingLead] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');

  if (!isOpen) return null;

  const grouped: { label: string; items: UpcomingEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.startIso);
    const group = grouped.find((g) => g.label === label);
    if (group) group.items.push(event);
    else grouped.push({ label, items: [event] });
  }

  const filteredLeads = leadSearch.trim()
    ? leads.filter(
        (l) => l.name?.toLowerCase().includes(leadSearch.toLowerCase()) || l.phone?.includes(leadSearch.trim())
      )
    : leads;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-emerald-400" />
            Agenda
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Atualizar"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          O que já está marcado no Google Calendar real — feito pela IA ou pelo painel.
        </p>

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300 mb-3">{error}</div>
        )}

        {isPickingLead ? (
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                placeholder="Buscar por nome ou telefone..."
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin">
              {filteredLeads.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">Nenhum contato encontrado.</p>
              )}
              {filteredLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => { onPickLeadForNewAppointment(lead); setIsPickingLead(false); setLeadSearch(''); }}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 text-left transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{lead.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{lead.phone}</div>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setIsPickingLead(false); setLeadSearch(''); }}
              className="w-full px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsPickingLead(true)}
              className="w-full mb-3 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Novo agendamento</span>
            </button>

            <div className="flex-1 overflow-y-auto space-y-4 min-h-0 scrollbar-thin">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : events.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">Nada agendado nos próximos dias.</p>
              ) : (
                grouped.map((group) => (
                  <div key={group.label}>
                    <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide mb-1.5">{group.label}</h4>
                    <div className="space-y-1.5">
                      {group.items.map((event) => (
                        <div key={event.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
                          <span className="text-xs font-bold text-white flex-shrink-0 w-11">{timeLabel(event.startIso)}</span>
                          <span className="text-xs text-slate-300 truncate">{event.summary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
