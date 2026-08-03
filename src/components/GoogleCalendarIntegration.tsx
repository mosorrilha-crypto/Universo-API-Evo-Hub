import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logoutGoogle, getAccessToken } from '../lib/googleAuth';
import {
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  GoogleCalendarEvent,
  CreateEventInput,
  listUserCalendars,
  CalendarListEntry
} from '../lib/googleCalendar';
import { LeadInfo, Tenant } from '../types';
import {
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  RefreshCw,
  Clock,
  MapPin,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Phone,
  DollarSign,
  ShieldAlert,
  LogOut,
  CalendarCheck
} from 'lucide-react';

import { INITIAL_MOCK_LEADS } from '../data/mockLeads';
import { INITIAL_TENANTS } from '../data/mockTenants';

interface GoogleCalendarIntegrationProps {
  activeTenant?: Tenant;
  leads?: LeadInfo[];
  showToast?: (msg: string) => void;
  initialLeadForSync?: LeadInfo | null;
}

export const GoogleCalendarIntegration: React.FC<GoogleCalendarIntegrationProps> = ({
  activeTenant: propActiveTenant,
  leads: propLeads,
  showToast = (_msg: string) => {},
  initialLeadForSync
}) => {
  const activeTenant = propActiveTenant || INITIAL_TENANTS[0];
  const leads = propLeads || INITIAL_MOCK_LEADS;
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Calendar State
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New Event Modal State
  const [isNewEventModalOpen, setIsNewEventModalOpen] = useState<boolean>(false);
  const [selectedLeadForSync, setSelectedLeadForSync] = useState<LeadInfo | null>(null);

  // Form State
  const [eventSummary, setEventSummary] = useState<string>('');
  const [eventDate, setEventDate] = useState<string>(
    new Date(Date.now() + 86400000).toISOString().split('T')[0] // Tomorrow as default
  );
  const [eventTime, setEventTime] = useState<string>('15:00');
  const [eventDurationMin, setEventDurationMin] = useState<number>(120);
  const [eventClientName, setEventClientName] = useState<string>('');
  const [eventClientPhone, setEventClientPhone] = useState<string>('');
  const [eventServiceName, setEventServiceName] = useState<string>('Micropigmentação (Microlips)');
  const [eventNotes, setEventNotes] = useState<string>('Seña de Gs 50.000 confirmada via transferência.');
  const [eventLocation, setEventLocation] = useState<string>(
    'Monique Sorrilha Beauty Studio - Calle Paso Bogarín 3665, Loma Merlo, Luque'
  );
  const [isSubmittingEvent, setIsSubmittingEvent] = useState<boolean>(false);

  // Mandatory Delete Confirmation Modal State
  const [eventToDelete, setEventToDelete] = useState<GoogleCalendarEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Initialize Auth State Listener
  useEffect(() => {
    setIsLoadingAuth(true);
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setAccessToken(token);
        setIsLoadingAuth(false);
      },
      () => {
        setGoogleUser(null);
        setAccessToken(null);
        setIsLoadingAuth(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Fetch events when access token is available
  useEffect(() => {
    if (accessToken) {
      loadCalendarData(accessToken, selectedCalendarId);
    }
  }, [accessToken, selectedCalendarId]);

  // Handle auto-open when navigating with a preselected lead from CRM
  useEffect(() => {
    if (initialLeadForSync) {
      handleOpenNewEventModal(initialLeadForSync);
    }
  }, [initialLeadForSync]);

  const loadCalendarData = async (token: string, calId: string) => {
    setIsLoadingEvents(true);
    setErrorMessage(null);
    try {
      const userCals = await listUserCalendars(token);
      setCalendars(userCals);

      const calendarEvents = await listCalendarEvents(token, calId);
      setEvents(calendarEvents);
    } catch (err: any) {
      console.error('Erro ao carregar dados do Google Calendar:', err);
      setErrorMessage(err.message || 'Falha ao sincronizar com Google Calendar.');
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setAccessToken(result.accessToken);
        showToast('Autenticado com sucesso no Google Calendar!');
        loadCalendarData(result.accessToken, selectedCalendarId);
      }
    } catch (err: any) {
      console.error('Erro ao conectar Google:', err);
      setErrorMessage(err.message || 'Não foi possível conectar a conta do Google.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogle();
    setGoogleUser(null);
    setAccessToken(null);
    setEvents([]);
    showToast('Desconectado do Google Calendar.');
  };

  const handleOpenNewEventModal = (lead?: LeadInfo) => {
    if (lead) {
      setSelectedLeadForSync(lead);
      setEventClientName(lead.name);
      setEventClientPhone(lead.phone);
      setEventServiceName(lead.sampleType || 'Agendamento de Procedimento');
      setEventSummary(`✨ Monique Studio: ${lead.name} - ${lead.sampleType || 'Micropigmentação'}`);
      setEventNotes(`Agendamento realizado via WhatsApp.\nLead: ${lead.name}\nTelefone: ${lead.phone}\nStatus Seña: Gs 50.000 confirmado.`);
    } else {
      setSelectedLeadForSync(null);
      setEventClientName('');
      setEventClientPhone('');
      setEventServiceName('Microlips (Micropigmentação Labial)');
      setEventSummary('✨ Monique Studio: Agendamento de Procedimento');
      setEventNotes('Seña de Gs 50.000 confirmada via transferência.');
    }
    setIsNewEventModalOpen(true);
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) {
      showToast('Por favor, faça login com o Google para agendar.');
      return;
    }

    setIsSubmittingEvent(true);
    setErrorMessage(null);

    try {
      // Calculate start and end ISO strings
      const startDateTimeStr = `${eventDate}T${eventTime}:00`;
      const startDate = new Date(startDateTimeStr);
      const endDate = new Date(startDate.getTime() + eventDurationMin * 60000);

      const input: CreateEventInput = {
        summary: eventSummary || `✨ Monique Studio: ${eventClientName || 'Cliente'} - ${eventServiceName}`,
        description: `Procedimento: ${eventServiceName}\nCliente: ${eventClientName}\nTelefone: ${eventClientPhone}\n\nObservações & Seña:\n${eventNotes}`,
        location: eventLocation,
        startDateTime: startDate.toISOString(),
        endDateTime: endDate.toISOString(),
        timeZone: 'America/Asuncion',
      };

      await createCalendarEvent(accessToken, input, selectedCalendarId);
      showToast('Agendamento criado com sucesso no Google Calendar!');
      setIsNewEventModalOpen(false);

      // Refresh calendar
      loadCalendarData(accessToken, selectedCalendarId);
    } catch (err: any) {
      console.error('Erro ao criar evento:', err);
      setErrorMessage(err.message || 'Falha ao criar o agendamento no Google Calendar.');
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  // Mandatory User Confirmation Handler for Delete/Cancel Operation
  const handleConfirmDeleteEvent = async () => {
    if (!eventToDelete || !accessToken) return;

    setIsDeleting(true);
    try {
      await deleteCalendarEvent(accessToken, eventToDelete.id, selectedCalendarId);
      showToast('Agendamento cancelado com sucesso no Google Calendar.');
      setEventToDelete(null);
      loadCalendarData(accessToken, selectedCalendarId);
    } catch (err: any) {
      console.error('Erro ao deletar evento:', err);
      setErrorMessage(err.message || 'Não foi possível cancelar o evento.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* HEADER BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-emerald-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white">Integração Google Calendar</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
                Sincronização em Tempo Real
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Agendamento automatizado de consultas de Micropigmentação, Cílios e reuniões no Google Calendar do estúdio.
            </p>
          </div>
        </div>

        {/* GOOGLE AUTH STATUS & BUTTON */}
        <div className="flex items-center space-x-3">
          {googleUser ? (
            <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-2 pl-3 rounded-xl">
              {googleUser.photoURL ? (
                <img src={googleUser.photoURL} alt={googleUser.displayName || 'Google User'} className="w-8 h-8 rounded-full border border-blue-400" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                  {googleUser.displayName?.[0] || 'G'}
                </div>
              )}
              <div className="text-left">
                <div className="text-xs font-bold text-white">{googleUser.displayName || 'Conta Google Conectada'}</div>
                <div className="text-[10px] text-emerald-400 font-mono">{googleUser.email}</div>
              </div>

              <button
                onClick={handleGoogleLogout}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-all ml-1"
                title="Desconectar do Google Calendar"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div>
              {/* Mandatory Official Google Sign-In Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoggingIn || isLoadingAuth}
                className="gsi-material-button relative inline-flex items-center justify-center p-0.5 overflow-hidden font-medium rounded-xl group bg-gradient-to-br from-blue-500 to-emerald-500 group-hover:from-blue-600 group-hover:to-emerald-600 hover:text-white dark:text-white shadow-lg"
              >
                <span className="relative px-4 py-2.5 transition-all ease-in duration-75 bg-slate-950 rounded-xl group-hover:bg-opacity-0 flex items-center space-x-2 text-xs font-bold text-white">
                  <svg className="w-4 h-4 mr-1" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  <span>{isLoggingIn ? 'Conectando ao Google...' : 'Conectar Google Calendar'}</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ERROR ALERT */}
      {errorMessage && (
        <div className="p-4 bg-rose-950/40 border border-rose-800 rounded-xl flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white font-bold ml-4">
            Fechar
          </button>
        </div>
      )}

      {/* MAIN CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: QUICK SYNC LEADS TO CALENDAR */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Sincronizar Leads no Agenda
              </h3>
              <p className="text-[11px] text-slate-400">
                Selecione um lead com seña de Gs 50.000 confirmada para lançar no Google Calendar
              </p>
            </div>
          </div>

          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="bg-slate-950 border border-slate-800 hover:border-blue-500/50 p-3.5 rounded-xl transition-all space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2.5">
                    {lead.avatarUrl ? (
                      <img src={lead.avatarUrl} alt={lead.name} className="w-8 h-8 rounded-full object-cover border border-slate-700" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-xs">
                        {lead.name[0]}
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-white text-xs">{lead.name}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3 text-emerald-400" />
                        {lead.phone}
                      </div>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    Seña Confirmada
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Procedimento: </span>
                  {lead.sampleType || 'Micropigmentação Labial / Sobrancelhas'}
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenNewEventModal(lead)}
                  disabled={!googleUser}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold text-xs rounded-lg flex items-center justify-center space-x-1.5 transition-all shadow"
                >
                  <CalendarCheck className="w-3.5 h-3.5" />
                  <span>{googleUser ? 'Agendar no Google Calendar' : 'Faça Login para Agendar'}</span>
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => handleOpenNewEventModal()}
            disabled={!googleUser}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Criar Novo Agendamento Personalizado</span>
          </button>
        </div>

        {/* RIGHT 2-COLUMNS: GOOGLE CALENDAR EVENTS LIST */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-blue-400" />
                Agendamentos no Google Calendar do Estúdio
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Visualização oficial sincronizada com os servidores do Google ({events.length} compromissos futuros)
              </p>
            </div>

            <div className="flex items-center space-x-2">
              {calendars.length > 0 && (
                <select
                  value={selectedCalendarId}
                  onChange={(e) => setSelectedCalendarId(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-white text-xs font-semibold rounded-xl p-2 focus:ring-1 focus:ring-blue-500"
                >
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary} {c.primary ? '(Principal)' : ''}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => accessToken && loadCalendarData(accessToken, selectedCalendarId)}
                disabled={!accessToken || isLoadingEvents}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center space-x-1"
                title="Atualizar lista do Google"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingEvents ? 'animate-spin text-blue-400' : ''}`} />
              </button>
            </div>
          </div>

          {!googleUser ? (
            <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-blue-950/60 border border-blue-800 mx-auto flex items-center justify-center text-blue-400">
                <CalendarIcon className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h4 className="text-base font-bold text-white">Conecte sua Conta Google para Visualizar Agendamentos</h4>
                <p className="text-xs text-slate-400">
                  Com a integração ativa, todos os procedimentos marcados via WhatsApp para Monique Sorrilha Beauty Studio serão sincronizados automaticamente com lembretes no seu celular.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all"
                >
                  Conectar Google Calendar Agora
                </button>
              </div>
            </div>
          ) : isLoadingEvents ? (
            <div className="p-12 text-center text-slate-400 text-xs space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400 mx-auto" />
              <p>Carregando compromissos diretos da API do Google Calendar...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="font-bold text-white">Nenhum agendamento futuro encontrado neste calendário.</p>
              <p>Utilize a coluna à esquerda para lançar os leads no Google Calendar.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {events.map((event) => {
                const startDate = event.start?.dateTime ? new Date(event.start.dateTime) : null;
                const endDate = event.end?.dateTime ? new Date(event.end.dateTime) : null;

                return (
                  <div
                    key={event.id}
                    className="bg-slate-950 border border-slate-800 hover:border-slate-700 p-4 rounded-xl space-y-2 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          {event.summary}
                        </h4>
                        <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1 font-mono">
                          <span className="flex items-center gap-1 text-blue-300">
                            <Clock className="w-3.5 h-3.5" />
                            {startDate ? startDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'Dia todo'}{' '}
                            {startDate ? `${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}h` : ''}
                            {endDate ? ` às ${endDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}h` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {event.htmlLink && (
                          <a
                            href={event.htmlLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-blue-400 rounded-lg text-xs"
                            title="Abrir no Google Calendar"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}

                        {/* Button to Open Mandatory Delete Confirmation Modal */}
                        <button
                          type="button"
                          onClick={() => setEventToDelete(event)}
                          className="p-1.5 bg-slate-900 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 rounded-lg text-xs transition-all"
                          title="Cancelar Agendamento no Google"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {event.description && (
                      <div className="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 whitespace-pre-line font-sans">
                        {event.description}
                      </div>
                    )}

                    {event.location && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span>{event.location}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* NEW EVENT FORM MODAL */}
      {isNewEventModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <CalendarIcon className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {selectedLeadForSync ? `Agendar Lead: ${selectedLeadForSync.name}` : 'Novo Agendamento Google Calendar'}
                </h3>
              </div>
              <button
                onClick={() => setIsNewEventModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Título do Evento no Google</label>
                <input
                  type="text"
                  required
                  value={eventSummary}
                  onChange={(e) => setEventSummary(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-semibold focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Data do Procedimento</label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Horário de Início</label>
                  <input
                    type="time"
                    required
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Procedimento Selecionado</label>
                  <select
                    value={eventServiceName}
                    onChange={(e) => setEventServiceName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Microlips (Micropigmentação Labial)">Microlips (Labial) - 120 min</option>
                    <option value="Microshading (Sobrancelhas)">Microshading (Sobrancelhas) - 120 min</option>
                    <option value="Pelo a Pelo (Sobrancelhas)">Pelo a Pelo (Sobrancelhas) - 120 min</option>
                    <option value="Combo Cejas + Labios">Combo Cejas + Labios - 180 min</option>
                    <option value="Lash Lift">Lash Lift - 90 min</option>
                    <option value="Efecto Volumen Brasileño">Efecto Volumen Brasileño - 90 min</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Duração Estimada (minutos)</label>
                  <input
                    type="number"
                    value={eventDurationMin}
                    onChange={(e) => setEventDurationMin(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Local do Atendimento</label>
                <input
                  type="text"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Descrição / Status da Seña</label>
                <textarea
                  rows={3}
                  value={eventNotes}
                  onChange={(e) => setEventNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewEventModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEvent}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow flex items-center space-x-1.5"
                >
                  <span>{isSubmittingEvent ? 'Salvando no Google...' : 'Confirmar e Agendar'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANDATORY USER CONFIRMATION DIALOG FOR DELETE / CANCEL OPERATION */}
      {eventToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-rose-800/80 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirmar Cancelamento no Google Calendar</h3>
                <p className="text-xs text-rose-300">Esta ação irá remover o compromisso do servidor do Google.</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl text-xs space-y-1">
              <div className="font-bold text-white">{eventToDelete.summary}</div>
              {eventToDelete.start?.dateTime && (
                <div className="text-slate-400 font-mono">
                  Data: {new Date(eventToDelete.start.dateTime).toLocaleString('pt-BR')}
                </div>
              )}
            </div>

            <p className="text-xs text-slate-300">
              Deseja realmente remover este agendamento do Google Calendar do estúdio? O cancelamento não poderá ser desfeito.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEventToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Manter Agendamento
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteEvent}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow transition-all"
              >
                {isDeleting ? 'Removendo...' : 'Sim, Remover do Google Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
