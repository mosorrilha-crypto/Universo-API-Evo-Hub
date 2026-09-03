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
} from 'lucide-react';
import type { ContactProfileData } from './ownerPanelTypes';
import { getInitials } from '../../utils/leadDisplay';

interface ConversationContextSidebarProps {
  contact: ContactProfileData | null;
  agentStatus: 'active' | 'paused' | 'restricted';
  onToggleAgentStatus?: () => void;
  onClose?: () => void;
  isMobile?: boolean;
}

export const ConversationContextSidebar: React.FC<ConversationContextSidebarProps> = ({
  contact,
  agentStatus,
  onToggleAgentStatus,
  onClose,
  isMobile,
}) => {
  const [copied, setCopied] = useState(false);

  if (!contact) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500 bg-zinc-900/70 border-l border-zinc-800">
        <User className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-xs">Selecione uma conversa para visualizar o contexto do contato.</p>
      </div>
    );
  }

  const handleCopyPhone = () => {
    if (contact.phone) {
      navigator.clipboard.writeText(contact.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenWhatsApp = () => {
    if (contact.phone) {
      const cleanPhone = contact.phone.replace(/\D/g, '');
      window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }
  };

  const initials = getInitials(contact.name);

  return (
    <div className="h-full overflow-y-auto bg-zinc-900 border-l border-zinc-800 p-5 space-y-6 select-text text-sm">
      {/* Botão Fechar no Mobile */}
      {isMobile && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Topo: Avatar + Nome + Telefone */}
      <div className="flex flex-col items-center text-center">
        <div className="w-18 h-18 rounded-full bg-emerald-700/80 border-2 border-emerald-500/40 flex items-center justify-center text-white text-xl font-bold shadow-lg mb-3">
          {initials}
        </div>
        <h3 className="font-bold text-base text-zinc-100">{contact.name}</h3>
        <p className="text-xs text-zinc-400 mt-0.5">{contact.phone}</p>

        {/* Ações Rápidas */}
        <div className="flex items-center gap-2.5 mt-3.5 w-full">
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="flex-1 py-1.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700/60 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir WhatsApp
          </button>
          <button
            type="button"
            onClick={handleCopyPhone}
            className="flex-1 py-1.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700/60 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bloco: FICHA (PLANILHA) */}
      <div className="border-t border-zinc-800/80 pt-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">
            Ficha (Planilha)
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-zinc-800/40">
            <span className="text-zinc-400">Interesse</span>
            <span className="font-medium text-zinc-200">{contact.interest || 'não informado'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-zinc-800/40">
            <span className="text-zinc-400">Agendou?</span>
            <span className={`font-semibold ${contact.hasBooked ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {contact.hasBooked ? 'sim' : 'não'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-zinc-800/40">
            <span className="text-zinc-400">Primeiro contato</span>
            <span className="font-mono text-zinc-300 text-[11px]">
              {contact.firstContactAt || 'recente'}
            </span>
          </div>
          <div className="flex items-start justify-between py-1">
            <span className="text-zinc-400">Observações</span>
            <span className="font-medium text-zinc-300 italic text-right max-w-[140px] truncate">
              {contact.notes || 'nenhuma'}
            </span>
          </div>
        </div>
      </div>

      {/* Bloco: ETAPA DO FUNIL */}
      <div className="border-t border-zinc-800/80 pt-4">
        <div className="bg-black/30 border border-zinc-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              Etapa do funil
            </span>
            <span className="text-[10px] font-bold text-zinc-400">
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
                    isFilled ? 'bg-emerald-500' : 'bg-zinc-800'
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Bloco: AGENDAMENTOS */}
      <div className="border-t border-zinc-800/80 pt-4">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 block mb-3">
          Agendamentos
        </span>

        {contact.upcomingAppointments && contact.upcomingAppointments.length > 0 ? (
          <div className="space-y-2.5">
            {contact.upcomingAppointments.map((appt) => (
              <div
                key={appt.id}
                className="flex items-start gap-2.5 p-2.5 bg-zinc-800/40 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-center shrink-0">
                  <span className="text-[11px] font-bold text-zinc-200 block">{appt.date}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-200 truncate">{appt.time} - {appt.title}</p>
                  <span className={`text-[10px] ${appt.status === 'passed' ? 'text-zinc-500' : 'text-emerald-400 font-medium'}`}>
                    {appt.status === 'passed' ? 'já passou' : 'confirmado'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 bg-zinc-800/20 rounded-xl border border-zinc-800 text-center">
            <span className="text-xs text-zinc-500">Nenhum agendamento ativo</span>
          </div>
        )}
      </div>

      {/* Bloco: STATUS DO AGENTE & INTERVENÇÃO */}
      <div className="border-t border-zinc-800/80 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className={`w-4 h-4 ${agentStatus === 'active' ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div>
              <span className="text-xs font-bold text-zinc-200 block">
                {agentStatus === 'active' ? 'Agente Ativo' : 'Agente Pausado'}
              </span>
              <span className="text-[10px] text-zinc-500">
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
