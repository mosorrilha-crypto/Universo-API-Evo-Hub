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
      className={`px-2.5 py-2 transition-colors cursor-pointer relative flex items-start space-x-2.5 ${
        isSelected
          ? 'bg-[var(--surface-raised)] border-l-4 border-[var(--action)]'
          : isUnread
          ? 'border-l-4 border-[color-mix(in_srgb,var(--action)_55%,transparent)] hover:bg-[var(--surface-raised)]'
          : 'border-l-4 border-transparent hover:bg-[var(--surface-raised)]'
      } ${isFlashing ? 'animate-flash-new-message' : ''}`}
    >
      <div className="relative flex-shrink-0">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[11px] border border-[var(--line-subtle)] ${avatarColorClasses(lead.name || lead.phone)}`}
        >
          {getInitials(lead.name || lead.phone)}
        </div>
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[var(--action)] border-2 border-[var(--surface-deep)]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-bold text-[var(--text-primary)] truncate flex items-center gap-1">
            <span className="truncate">{lead.name}</span>
          </h4>
          <div className="flex items-center space-x-1">
            {isAiBlocked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-surface)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--danger)]" title="IA bloqueada — lead não qualificado">
                <Ban className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                <span>IA bloqueada</span>
              </span>
            )}
            {isMuted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-secondary)]" title="Conversa silenciada">
                <BellOff className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                <span>Silenciada</span>
              </span>
            )}
            <span className={`text-[10px] ${isSelected || isUnread ? 'text-[var(--action)] font-bold' : 'text-[var(--text-secondary)]'}`}>
              {lead.timestamp}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] rounded transition-colors cursor-pointer"
              title="Mais opções"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Message Preview */}
          <div className="flex items-center justify-between mt-0.5">
          <p className={`text-[10px] truncate flex items-center pr-2 ${isUnread ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>
            {lastMsg ? (
              <>
                {lastMsg.sender === 'agent' && (
                  <CheckCheck className="w-3.5 h-3.5 text-[var(--action)] mr-1 flex-shrink-0" />
                )}
                {lastMsg.type === 'audio' && <Mic className="w-3 h-3 text-[var(--action)] mr-1 flex-shrink-0" />}
                {lastMsg.type === 'image' && <ImageIcon className="w-3 h-3 text-[var(--text-secondary)] mr-1 flex-shrink-0" />}
                {lastMsg.type === 'file' && <FileText className="w-3 h-3 text-[var(--text-secondary)] mr-1 flex-shrink-0" />}
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
              <span className="w-5 h-5 rounded-full bg-[var(--action)] text-[var(--action-contrast)] font-extrabold text-[10px] flex items-center justify-center flex-shrink-0">
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
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
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
            className="absolute right-2 top-10 z-50 w-52 bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden text-xs origin-top-right animate-pop-in"
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
