import React, { useState } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  Bot,
  AlertCircle,
  X,
  RefreshCw,
  PencilLine,
  Save,
  Loader2,
} from 'lucide-react';
import type { ContactProfileData } from './ownerPanelTypes';
import { ContactJourneyTimeline } from './ContactJourneyTimeline';
import type { ContactJourneyEvent } from '../../types';

interface ConversationContextSidebarProps {
  contact: ContactProfileData | null;
  agentStatus: 'active' | 'paused' | 'restricted';
  onToggleAgentStatus?: () => void;
  onClose?: () => void;
  isMobile?: boolean;
  /** TASK-0292 (pedido direto, print: "este campo não está conectado a agenda, e eu não consigo editar pois a cliente remarcou") — o card AGENDAMENTOS é só leitura, sem jeito de corrigir um horário desatualizado quando o reagendamento aconteceu fora dos fluxos que escrevem em `appointments` (ex.: editar o evento direto no Google Calendar). Ressincroniza com o estado atual do mesmo evento (POST /api/conversations/:phone/appointment/resync). */
  onResyncAppointment?: () => Promise<void> | void;
  /** Histórico cronológico do contato (agendamentos + mudanças de estágio do CRM) — GET /api/conversations/:phone/journey, sem backfill. */
  journeyEvents?: ContactJourneyEvent[];
  isJourneyLoading?: boolean;
  /**
   * TASK-0375 (pedido direto): "Observações" aqui é o MESMO
   * `conversation_summary` já editável na Ficha IA (`ContactContextPanel`) —
   * reaproveita o mesmo endpoint (`PATCH /api/conversations/:phone/context/memory`,
   * já chamado por `handleSaveContactMemory` em `WhatsAppLeadsSim.tsx`), só
   * expõe um segundo ponto de edição inline (campo único, não o formulário
   * inteiro) pra quem está nesta aba.
   */
  onSaveMemory?: (patch: { conversationSummary: string | null }) => Promise<void>;
}

export const ConversationContextSidebar: React.FC<ConversationContextSidebarProps> = ({
  contact,
  agentStatus,
  onToggleAgentStatus,
  onClose,
  isMobile,
  onResyncAppointment,
  journeyEvents,
  isJourneyLoading,
  onSaveMemory,
}) => {
  const [copied, setCopied] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const handleResync = async () => {
    if (!onResyncAppointment || isResyncing) return;
    setIsResyncing(true);
    try {
      await onResyncAppointment();
    } finally {
      setIsResyncing(false);
    }
  };

  if (!contact) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 bg-slate-900/70 border-l border-slate-800">
        <User className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-xs">Selecione uma conversa para visualizar o contexto do contato.</p>
      </div>
    );
  }

  // TASK-0375 (pedido direto): antes copiava só o telefone cru; agora monta
  // um bloco de texto pronto pra colar num documento/impressão, com os
  // mesmos campos já mostrados na ficha logo abaixo.
  const handleCopyProfile = () => {
    const lines = [
      `Nome: ${contact.name}`,
      `Telefone: ${contact.phone}`,
      `Interesse: ${contact.interest || 'não informado'}`,
      `Agendou?: ${contact.hasBooked ? 'sim' : 'não'}`,
      `Primeiro contato: ${contact.firstContactAt || 'recente'}`,
      `Observações: ${contact.notes || 'nenhuma'}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWhatsApp = () => {
    if (contact.phone) {
      const cleanPhone = contact.phone.replace(/\D/g, '');
      window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }
  };

  const startEditingNotes = () => {
    setNotesDraft(contact.notes || '');
    setNotesError(null);
    setIsEditingNotes(true);
  };
  const cancelEditingNotes = () => {
    setIsEditingNotes(false);
    setNotesError(null);
  };
  const saveNotes = async () => {
    if (!onSaveMemory) return;
    setIsSavingNotes(true);
    setNotesError(null);
    try {
      await onSaveMemory({ conversationSummary: notesDraft.replace(/\s+/g, ' ').trim() || null });
      setIsEditingNotes(false);
    } catch (error: any) {
      setNotesError(error?.message || 'Não foi possível salvar as observações agora.');
    } finally {
      setIsSavingNotes(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-900 border-l border-slate-800 p-5 space-y-6 select-text text-sm">
      {/* Botão Fechar no Mobile */}
      {isMobile && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Topo: Nome + Telefone — TASK-0375 (pedido direto): o círculo de
          avatar com iniciais foi removido (nunca havia foto real ali; a
          Meta Cloud API não expõe foto de perfil de contato — ver
          leadDisplay.ts), e o nome ganhou mais destaque no lugar. */}
      <div className="flex flex-col items-center text-center">
        <h3 className="font-bold text-xl tracking-tight text-slate-100">{contact.name}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{contact.phone}</p>

        {/* Ações Rápidas */}
        <div className="flex items-center gap-2.5 mt-3.5 w-full">
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="flex-1 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir WhatsApp
          </button>
          <button
            type="button"
            onClick={handleCopyProfile}
            title="Copia nome, telefone, interesse, status e observações em texto formatado, pronto pra colar num documento ou impressão"
            className="flex-1 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar ficha
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bloco: FICHA (PLANILHA) */}
      <div className="border-t border-slate-800/80 pt-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Ficha (Planilha)
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
            <span className="text-slate-400">Interesse</span>
            <span className="font-medium text-slate-200">{contact.interest || 'não informado'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
            <span className="text-slate-400">Agendou?</span>
            <span className={`font-semibold ${contact.hasBooked ? 'text-emerald-400' : 'text-slate-400'}`}>
              {contact.hasBooked ? 'sim' : 'não'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
            <span className="text-slate-400">Primeiro contato</span>
            <span className="font-mono text-slate-300 text-[11px]">
              {contact.firstContactAt || 'recente'}
            </span>
          </div>
          <div className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Observações</span>
              {onSaveMemory && !isEditingNotes && (
                <button
                  type="button"
                  onClick={startEditingNotes}
                  className="text-slate-500 hover:text-sky-300 transition-colors cursor-pointer"
                  title="Editar observações"
                >
                  <PencilLine className="w-3 h-3" />
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="mt-1.5 space-y-1.5">
                <textarea
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  maxLength={900}
                  className="w-full min-h-20 resize-y rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
                {notesError && <p className="text-[10px] text-rose-300">{notesError}</p>}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={cancelEditingNotes}
                    disabled={isSavingNotes}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveNotes()}
                    disabled={isSavingNotes}
                    className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {isSavingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {isSavingNotes ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 font-medium text-slate-300 italic whitespace-normal break-words">
                {contact.notes || 'nenhuma'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bloco: ETAPA DO FUNIL */}
      <div className="border-t border-slate-800/80 pt-4">
        <div className="bg-black/30 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Etapa do funil
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              {contact.funnelStage ? `${contact.funnelStage.currentStep} de ${contact.funnelStage.totalSteps}` : '5 de 5'}
            </span>
          </div>

          <p className="text-xs font-bold text-white">
            {contact.funnelStage?.name || (contact.hasBooked ? 'Agendamento Confirmado' : 'Em Qualificação')}
          </p>

          {/* Barra de Progresso Segmentada */}
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((step) => {
              const current = contact.funnelStage?.currentStep || (contact.hasBooked ? 5 : 3);
              const isFilled = step <= current;
              return (
                <div
                  key={step}
                  className={`h-1.5 flex-1 rounded-full ${
                    isFilled ? 'bg-emerald-500' : 'bg-slate-800'
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Bloco: AGENDAMENTOS */}
      <div className="border-t border-slate-800/80 pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Agendamentos
          </span>
          {onResyncAppointment && contact.upcomingAppointments && contact.upcomingAppointments.length > 0 && (
            <button
              type="button"
              onClick={handleResync}
              disabled={isResyncing}
              title="Ressincronizar com o horário atual da agenda — use se a cliente remarcou por fora (ex.: direto no Google Calendar) e este card ficou desatualizado."
              className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-50 disabled:cursor-wait"
            >
              <RefreshCw className={`w-3 h-3 ${isResyncing ? 'animate-spin' : ''}`} />
              {isResyncing ? 'Ressincronizando...' : 'Ressincronizar'}
            </button>
          )}
        </div>

        {contact.upcomingAppointments && contact.upcomingAppointments.length > 0 ? (
          <div className="space-y-2.5">
            {contact.upcomingAppointments.map((appt) => (
              <div
                key={appt.id}
                className="flex items-start gap-2.5 p-2.5 bg-slate-800/40 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <div className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-center shrink-0">
                  <span className="text-[11px] font-bold text-slate-200 block">{appt.date}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-200 truncate">{appt.time} - {appt.title}</p>
                  <span className={`text-[10px] ${appt.status === 'passed' ? 'text-slate-500' : appt.status === 'pending_payment' ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'}`}>
                    {appt.status === 'passed' ? 'já passou' : appt.status === 'pending_payment' ? 'pré-reserva — aguardando comprovante' : 'confirmado'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 bg-slate-800/20 rounded-xl border border-slate-800 text-center">
            <span className="text-xs text-slate-500">Nenhum agendamento ativo</span>
          </div>
        )}
      </div>

      <ContactJourneyTimeline events={journeyEvents || []} isLoading={Boolean(isJourneyLoading)} />

      {/* Bloco: STATUS DO AGENTE & INTERVENÇÃO */}
      <div className="border-t border-slate-800/80 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className={`w-4 h-4 ${agentStatus === 'active' ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div>
              <span className="text-xs font-bold text-slate-200 block">
                {agentStatus === 'active' ? 'Agente Ativo' : 'Agente Pausado'}
              </span>
              <span className="text-[10px] text-slate-500">
                {agentStatus === 'active' ? 'Respondendo automaticamente' : 'Controle manual humano'}
              </span>
            </div>
          </div>

          {onToggleAgentStatus && (
            <button
              type="button"
              onClick={onToggleAgentStatus}
              className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline"
            >
              {agentStatus === 'active' ? 'Pausar IA' : 'Devolver à IA'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
