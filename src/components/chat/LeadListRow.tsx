import React from 'react';
import { LeadInfo } from '../../types';
import { labelColorClasses, avatarColorClasses, getInitials } from '../../utils/leadDisplay';
import {
  Ban, BellOff, MoreVertical, CheckCheck, Mic, Image as ImageIcon, FileText, Pin,
  Pencil, Bell, Mail, Archive, ArchiveRestore, PinOff, Trash2,
} from 'lucide-react';

interface LeadListRowProps {
  lead: LeadInfo;
  isSelected: boolean;
  isFlashing: boolean;
  unreadCount: number;
  isMenuOpen: boolean;
  onSelect: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRename: () => void;
  onToggleAiBlocked: () => void;
  onTogglePinned: () => void;
  onToggleManuallyUnread: () => void;
  onToggleMuted: () => void;
  onToggleArchived: () => void;
  onDelete: () => void;
}

export const LeadListRow: React.FC<LeadListRowProps> = ({
  lead, isSelected, isFlashing, unreadCount, isMenuOpen,
  onSelect, onToggleMenu, onCloseMenu, onRename, onToggleAiBlocked,
  onTogglePinned, onToggleManuallyUnread, onToggleMuted, onToggleArchived, onDelete,
}) => {
  const lastMsg = lead.messages && lead.messages.length > 0 ? lead.messages[lead.messages.length - 1] : null;
  const isPinned = !!lead.pinnedAt;
  const isMuted = !!lead.muted;
  const isArchived = !!lead.archivedAt;
  const isManuallyUnread = !!lead.manuallyUnread;
  const isAiBlocked = !!lead.aiBlockedAt;
  const isUnread = unreadCount > 0;

  return (
    <div
      key={lead.id}
      onClick={onSelect}
      className={`p-3 transition-colors cursor-pointer relative flex items-start space-x-3 ${
        isSelected
          ? 'bg-[#2a3942] border-l-4 border-[#00a884]'
          : isUnread
          ? 'border-l-4 border-[#00a884]/50 hover:bg-[#202c33]'
          : 'border-l-4 border-transparent hover:bg-[#202c33]'
      } ${isFlashing ? 'animate-flash-new-message' : ''}`}
    >
      <div className="relative flex-shrink-0">
        <div
          className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs border border-slate-700 ${avatarColorClasses(lead.name || lead.phone)}`}
        >
          {getInitials(lead.name || lead.phone)}
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#111b21]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-[#e9edef] truncate flex items-center gap-1">
            <span className="truncate">{lead.name}</span>
          </h4>
          <div className="flex items-center space-x-1">
            {isAiBlocked && <Ban className="w-3 h-3 text-rose-400 flex-shrink-0" title="IA bloqueada — lead não qualificado" />}
            {isMuted && <BellOff className="w-3 h-3 text-slate-500 flex-shrink-0" title="Silenciada" />}
            <span className={`text-[10px] ${isSelected || isUnread ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
              {lead.timestamp}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded transition-colors cursor-pointer"
              title="Mais opções"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Message Preview */}
        <div className="flex items-center justify-between mt-1">
          <p className={`text-[11px] truncate flex items-center pr-2 ${isUnread ? 'text-[#e9edef] font-semibold' : 'text-slate-400'}`}>
            {lastMsg ? (
              <>
                {lastMsg.sender === 'agent' && (
                  <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] mr-1 flex-shrink-0" />
                )}
                {lastMsg.type === 'audio' && <Mic className="w-3 h-3 text-emerald-400 mr-1 flex-shrink-0" />}
                {lastMsg.type === 'image' && <ImageIcon className="w-3 h-3 text-blue-400 mr-1 flex-shrink-0" />}
                {lastMsg.type === 'file' && <FileText className="w-3 h-3 text-purple-400 mr-1 flex-shrink-0" />}
                <span className="truncate">
                  {lastMsg.type === 'audio'
                    ? 'Áudio do WhatsApp'
                    : lastMsg.type === 'image'
                    ? 'Foto'
                    : lastMsg.type === 'file'
                    ? 'Documento PDF'
                    : lastMsg.text}
                </span>
              </>
            ) : (
              lead.textContent
            )}
          </p>

          {/* Pin (se fixada) + badge de não lidas ou tag de estágio — mesmo
              canto inferior direito do WhatsApp Web real (o pin não fica
              colado no nome, fica aqui embaixo, ao lado do indicador). */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {isPinned && <Pin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
            {unreadCount > 0 ? (
              <span className="w-5 h-5 rounded-full bg-[#00a884] text-slate-950 font-extrabold text-[10px] flex items-center justify-center flex-shrink-0">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : lead.fullAnalysis ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60 flex-shrink-0">
                {lead.fullAnalysis.dealProbability}%
              </span>
            ) : null}
          </div>
        </div>

        {/* Etiquetas livres (tipo WhatsApp Business) */}
        {lead.conversationLabels && lead.conversationLabels.length > 0 && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {lead.conversationLabels.map((label) => (
              <span
                key={label}
                className={`text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${labelColorClasses(label)}`}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {isMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => { e.stopPropagation(); onCloseMenu(); }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-10 z-50 w-52 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs origin-top-right animate-pop-in"
          >
            <button
              onClick={() => { onCloseMenu(); onRename(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Editar nome do contato</span>
            </button>
            <button
              onClick={() => { onToggleAiBlocked(); onCloseMenu(); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-700/60 transition-colors cursor-pointer ${isAiBlocked ? 'text-emerald-300' : 'text-rose-300'}`}
              title="A IA para de responder automaticamente só pra esse número (manual ou automático, ex: falha de agenda) — o resto do atendimento continua normal"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>{isAiBlocked ? 'Reativar IA pra esse lead' : 'Bloquear IA pra esse lead'}</span>
            </button>
            <button
              onClick={() => { onTogglePinned(); onCloseMenu(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              <span>{isPinned ? 'Desafixar conversa' : 'Fixar conversa'}</span>
            </button>
            <button
              onClick={() => { onToggleManuallyUnread(); onCloseMenu(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{isManuallyUnread ? 'Marcar como lida' : 'Marcar como não lida'}</span>
            </button>
            <button
              onClick={() => { onToggleMuted(); onCloseMenu(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              <span>{isMuted ? 'Ativar notificações' : 'Silenciar notificações'}</span>
            </button>
            <button
              onClick={() => { onToggleArchived(); onCloseMenu(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              <span>{isArchived ? 'Desarquivar conversa' : 'Arquivar conversa'}</span>
            </button>
            <button
              onClick={() => { onCloseMenu(); onDelete(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-rose-950/60 transition-colors cursor-pointer border-t border-slate-700"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Excluir conversa</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
