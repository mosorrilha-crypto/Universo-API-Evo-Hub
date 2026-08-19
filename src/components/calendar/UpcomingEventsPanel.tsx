import React, { useState } from 'react';
import { LeadInfo } from '../../types';
import { Calendar as CalendarIcon, X, Loader2, RefreshCw, PlusCircle, Search, UserPlus, ChevronLeft, ChevronRight, Check, ChevronUp, ChevronDown, List, Grid3x3, Pencil } from 'lucide-react';

export interface UpcomingEvent {
  id: string;
  summary: string;
  startIso: string;
  description?: string;
  /** Marcado como concluído no painel (calendarEventCompletionStore.ts) — o evento do Google Calendar em si nunca muda. */
  completed?: boolean;
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
  /** Contato que veio de outra fonte (indicação, telefone, presencial) e ainda não tem conversa/lead nenhum registrado aqui. */
  onCreateAdHocContactForAppointment: (name: string, phone: string) => void;
  /** Rótulo do mês em exibição (ex: "Agosto 2026") — pedido real (15/08/2026): a agenda só mostrava "os próximos dias a partir de agora", sem jeito de olhar um mês específico (nem o corrente inteiro). */
  monthLabel: string;
  /** Ano/mês(1-12) em exibição — pedido real (18/08/2026: "lista não está muito interessante, calendário mensal ficaria melhor") — precisa pra montar a grade de dias do mês, `monthLabel` sozinho não basta. */
  calendarYear: number;
  calendarMonthNumber: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** Marca/desmarca um atendimento como concluído — some da lista ativa e vai pra seção "Concluídos" (colapsada por padrão, mesmo padrão de "Arquivadas" no Atendimento WhatsApp). */
  onToggleCompleted: (eventId: string, completed: boolean) => void;
  /** Corrige o título (serviço) de um evento já criado — pedido real (19/08/2026): não existia nenhum jeito de editar isso depois de criado. */
  onEditSummary: (eventId: string, newSummary: string) => Promise<void>;
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

/** "YYYY-MM-DD" local (não UTC) — chave de agrupamento por dia da grade do calendário. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAY_HEADER = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/**
 * Título do evento, com edição inline (lápis → campo de texto → salvar) —
 * pedido real (19/08/2026): não existia nenhum jeito de corrigir o nome do
 * serviço depois de um agendamento criado (só criar/remarcar horário/
 * cancelar/marcar concluído). Componente próprio pra não duplicar essa
 * lógica nas 3 listagens (lista, calendário ativo, calendário concluído).
 */
const EditableSummary: React.FC<{ event: UpcomingEvent; onEditSummary: (eventId: string, newSummary: string) => Promise<void> }> = ({ event, onEditSummary }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(event.summary);
  const [isSaving, setIsSaving] = useState(false);

  if (isEditing) {
    return (
      <form
        className="flex-1 min-w-0 flex items-center gap-1"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim() || draft.trim() === event.summary) { setIsEditing(false); return; }
          setIsSaving(true);
          try {
            await onEditSummary(event.id, draft.trim());
            setIsEditing(false);
          } finally {
            setIsSaving(false);
          }
        }}
      >
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSaving}
          className="flex-1 min-w-0 px-1.5 py-0.5 bg-slate-900 border border-emerald-600 rounded text-xs text-white focus:outline-none disabled:opacity-50"
        />
        <button type="submit" disabled={isSaving} title="Salvar" className="flex-shrink-0 text-emerald-400 hover:text-emerald-300 disabled:opacity-50 cursor-pointer">
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button type="button" disabled={isSaving} onClick={() => { setDraft(event.summary); setIsEditing(false); }} title="Cancelar" className="flex-shrink-0 text-slate-500 hover:text-white disabled:opacity-50 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  return (
    <span className="flex-1 min-w-0 flex items-center gap-1.5 group/summary">
      <span className="text-xs text-slate-300 truncate">{event.summary}</span>
      <button
        type="button"
        onClick={() => { setDraft(event.summary); setIsEditing(true); }}
        title="Editar serviço"
        className="flex-shrink-0 text-slate-600 hover:text-emerald-400 opacity-0 group-hover/summary:opacity-100 transition-opacity cursor-pointer"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </span>
  );
};

export const UpcomingEventsPanel: React.FC<UpcomingEventsPanelProps> = ({
  isOpen, onClose, events, isLoading, error, onRefresh, leads, onPickLeadForNewAppointment, onCreateAdHocContactForAppointment,
  monthLabel, calendarYear, calendarMonthNumber, onPrevMonth, onNextMonth, onToggleCompleted, onEditSummary,
}) => {
  const [isPickingLead, setIsPickingLead] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [isTypingNewContact, setIsTypingNewContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  // Alternador Lista/Calendário (pedido real, 18/08/2026: "a lista não está
  // muito interessante, um calendário mensal ficaria visualmente melhor").
  // Lista continua sendo o padrão — calendário é só uma visão alternativa
  // dos MESMOS eventos já carregados, sem fetch novo nenhum.
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const resetPicker = () => {
    setIsPickingLead(false);
    setLeadSearch('');
    setIsTypingNewContact(false);
    setNewContactName('');
    setNewContactPhone('');
  };

  if (!isOpen) return null;

  const activeEvents = events.filter((e) => !e.completed);
  const completedEvents = events.filter((e) => e.completed);

  const grouped: { label: string; items: UpcomingEvent[] }[] = [];
  for (const event of activeEvents) {
    const label = dayLabel(event.startIso);
    const group = grouped.find((g) => g.label === label);
    if (group) group.items.push(event);
    else grouped.push({ label, items: [event] });
  }

  // Grade do mês (visão calendário) — dia 1 de calendarMonthNumber até o
  // último dia, preenchendo os espaços antes/depois com dias do mês
  // vizinho (cinza, não clicáveis) só pra fechar as semanas visualmente,
  // sempre começando na segunda-feira.
  const eventsByDateKey = new Map<string, UpcomingEvent[]>();
  for (const event of events) {
    const key = dateKey(new Date(event.startIso));
    const list = eventsByDateKey.get(key);
    if (list) list.push(event);
    else eventsByDateKey.set(key, [event]);
  }
  const firstOfMonth = new Date(calendarYear, calendarMonthNumber - 1, 1);
  const lastOfMonth = new Date(calendarYear, calendarMonthNumber, 0);
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // 0=segunda
  const gridDays: { date: Date; inMonth: boolean }[] = [];
  for (let i = leadingBlanks; i > 0; i--) {
    gridDays.push({ date: new Date(calendarYear, calendarMonthNumber - 1, 1 - i), inMonth: false });
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    gridDays.push({ date: new Date(calendarYear, calendarMonthNumber - 1, d), inMonth: true });
  }
  while (gridDays.length % 7 !== 0) {
    const last = gridDays[gridDays.length - 1].date;
    gridDays.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  const todayKey = dateKey(new Date());
  const selectedDayEvents = selectedDateKey ? (eventsByDateKey.get(selectedDateKey) || []) : [];
  const selectedDayActive = selectedDayEvents.filter((e) => !e.completed);
  const selectedDayCompleted = selectedDayEvents.filter((e) => e.completed);

  const filteredLeads = leadSearch.trim()
    ? leads.filter(
        (l) => l.name?.toLowerCase().includes(leadSearch.toLowerCase()) || l.phone?.includes(leadSearch.trim())
      )
    : leads;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full shadow-2xl max-h-[85vh] flex flex-col transition-all ${viewMode === 'calendar' && !isPickingLead ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-emerald-400" />
            Agenda
          </h3>
          <div className="flex items-center gap-1.5">
            {!isPickingLead && (
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 mr-1">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="Ver como lista"
                  className={`p-1 rounded cursor-pointer ${viewMode === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-white'}`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('calendar')}
                  title="Ver como calendário"
                  className={`p-1 rounded cursor-pointer ${viewMode === 'calendar' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-white'}`}
                >
                  <Grid3x3 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
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

        {!isPickingLead && (
          <div className="flex items-center justify-between mb-3 bg-slate-950 border border-slate-800 rounded-xl px-1.5 py-1">
            <button
              type="button"
              onClick={() => { setSelectedDateKey(null); onPrevMonth(); }}
              title="Mês anterior"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-white capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => { setSelectedDateKey(null); onNextMonth(); }}
              title="Próximo mês"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300 mb-3">{error}</div>
        )}

        {isPickingLead ? (
          isTypingNewContact ? (
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              <p className="text-xs text-slate-400">
                Contato que veio de outra fonte (indicação, telefone, presencial) e ainda não tem conversa registrada aqui.
              </p>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Nome</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ex: Mariana Costa"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Telefone / WhatsApp *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: +595 984 556975"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetPicker}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!newContactPhone.replace(/\D/g, '')}
                  onClick={() => { onCreateAdHocContactForAppointment(newContactName, newContactPhone); resetPicker(); }}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
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
                    onClick={() => { onPickLeadForNewAppointment(lead); resetPicker(); }}
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
                onClick={() => setIsTypingNewContact(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Não encontrou? Cadastrar telefone novo</span>
              </button>
              <button
                type="button"
                onClick={resetPicker}
                className="w-full px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          )
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

            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : viewMode === 'calendar' ? (
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin space-y-3">
                <div>
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {WEEKDAY_HEADER.map((w) => (
                      <div key={w} className="text-center text-[10px] font-bold text-slate-500 uppercase">{w}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {gridDays.map(({ date, inMonth }) => {
                      const key = dateKey(date);
                      const dayEvents = eventsByDateKey.get(key) || [];
                      const dayActiveCount = dayEvents.filter((e) => !e.completed).length;
                      const isToday = key === todayKey;
                      const isSelected = key === selectedDateKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!inMonth}
                          onClick={() => setSelectedDateKey((prev) => (prev === key ? null : key))}
                          className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                            !inMonth
                              ? 'text-slate-700 cursor-default'
                              : isSelected
                              ? 'bg-emerald-600 text-white font-bold cursor-pointer'
                              : isToday
                              ? 'bg-slate-800 text-emerald-400 font-bold border border-emerald-700 cursor-pointer'
                              : 'text-slate-300 hover:bg-slate-800 cursor-pointer'
                          }`}
                        >
                          <span>{date.getDate()}</span>
                          {dayActiveCount > 0 && (
                            <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedDateKey && (
                  <div className="border-t border-slate-800 pt-2 space-y-1.5">
                    <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
                      {new Date(selectedDateKey + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                    </h4>
                    {selectedDayEvents.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">Nada agendado neste dia.</p>
                    ) : (
                      <>
                        {selectedDayActive.map((event) => (
                          <div key={event.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => onToggleCompleted(event.id, true)}
                              title="Marcar como concluído"
                              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded border border-slate-600 hover:border-emerald-500 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                            />
                            <span className="text-xs font-bold text-white flex-shrink-0 w-11">{timeLabel(event.startIso)}</span>
                            <EditableSummary event={event} onEditSummary={onEditSummary} />
                          </div>
                        ))}
                        {selectedDayCompleted.map((event) => (
                          <div key={event.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/50">
                            <button
                              type="button"
                              onClick={() => onToggleCompleted(event.id, false)}
                              title="Desmarcar conclusão"
                              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded bg-emerald-600 border border-emerald-600 flex items-center justify-center cursor-pointer"
                            >
                              <Check className="w-3 h-3 text-white" />
                            </button>
                            <span className="text-xs font-bold text-slate-500 flex-shrink-0 w-11 line-through">{timeLabel(event.startIso)}</span>
                            <span className="text-xs text-slate-500 truncate line-through">{event.summary}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-4 min-h-0 scrollbar-thin">
                {activeEvents.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">Nada agendado neste mês.</p>
                ) : (
                  grouped.map((group) => (
                    <div key={group.label}>
                      <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide mb-1.5">{group.label}</h4>
                      <div className="space-y-1.5">
                        {group.items.map((event) => (
                          <div key={event.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => onToggleCompleted(event.id, true)}
                              title="Marcar como concluído"
                              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded border border-slate-600 hover:border-emerald-500 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                            />
                            <span className="text-xs font-bold text-white flex-shrink-0 w-11">{timeLabel(event.startIso)}</span>
                            <EditableSummary event={event} onEditSummary={onEditSummary} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {/* Concluídos — colapsado por padrão, mesmo padrão de "Arquivadas"
                    no Atendimento WhatsApp. Fica marcado com um check verde e
                    texto riscado; some da lista ativa (e da conta de pendentes)
                    assim que marcado. */}
                {completedEvents.length > 0 && (
                  <div className="border-t border-slate-800 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="w-full flex items-center justify-between px-1 py-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-medium">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        Concluídos · {completedEvents.length}
                      </span>
                      {showCompleted ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showCompleted && (
                      <div className="space-y-1.5 mt-1.5">
                        {completedEvents.map((event) => (
                          <div key={event.id} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/50">
                            <button
                              type="button"
                              onClick={() => onToggleCompleted(event.id, false)}
                              title="Desmarcar conclusão"
                              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded bg-emerald-600 border border-emerald-600 flex items-center justify-center cursor-pointer"
                            >
                              <Check className="w-3 h-3 text-white" />
                            </button>
                            <span className="text-xs font-bold text-slate-500 flex-shrink-0 w-11 line-through">{timeLabel(event.startIso)}</span>
                            <span className="text-xs text-slate-500 truncate line-through">{event.summary}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
