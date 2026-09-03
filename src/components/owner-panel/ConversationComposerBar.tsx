import React, { useState } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  Smile,
  Loader2,
  AlertTriangle,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { ServiceWindowStatus } from './ownerPanelTypes';
import { AutoResizeTextarea } from '../AutoResizeTextarea';

interface ConversationComposerBarProps {
  inputText: string;
  onChangeInputText: (text: string) => void;
  onSendTextMessage: () => void;
  onAttachFileClick: () => void;
  onStartAudioRecord: () => void;
  isSending: boolean;
  serviceWindow: ServiceWindowStatus | null;
  onOpenReopenModal: () => void;
  isAgentActive: boolean;
}

export const ConversationComposerBar: React.FC<ConversationComposerBarProps> = ({
  inputText,
  onChangeInputText,
  onSendTextMessage,
  onAttachFileClick,
  onStartAudioRecord,
  isSending,
  serviceWindow,
  onOpenReopenModal,
  isAgentActive,
}) => {
  const isWindowOpen = serviceWindow ? serviceWindow.withinWindow : true;
  const hoursRemaining = serviceWindow?.hoursRemaining ?? 24;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim() && !isSending && isWindowOpen) {
        onSendTextMessage();
      }
    }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/90 backdrop-blur-md p-3 space-y-2">
      {/* Faixa de Status da Janela de 24 Horas */}
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/50 rounded-xl border border-zinc-750 text-[11px]">
        {isWindowOpen ? (
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="flex items-center gap-1.5 font-bold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              aberta - faltam {hoursRemaining}h
            </span>
            <span className="text-zinc-500 hidden sm:inline">•</span>
            <span className="text-zinc-400 hidden sm:inline">
              O agente pode responder normalmente. A janela fecha {hoursRemaining}h depois de agora, se o cliente não escrever de novo.
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>Janela de 24h fechada. Envio de texto livre bloqueado pela Meta.</span>
            </div>
            <button
              type="button"
              onClick={onOpenReopenModal}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              Reabrir a conversa
            </button>
          </div>
        )}
      </div>

      {/* Caixa do Composer */}
      <div className="flex items-end gap-2 bg-zinc-800/80 border border-zinc-700/60 rounded-2xl p-2 focus-within:border-emerald-500/80 transition-all">
        {/* Botão Anexar Mídia */}
        <button
          type="button"
          onClick={onAttachFileClick}
          disabled={!isWindowOpen || isSending}
          title="Anexar foto ou documento"
          className="p-2 text-zinc-400 hover:text-zinc-100 rounded-xl hover:bg-zinc-700 transition-colors disabled:opacity-30"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Input de Mensagem */}
        <div className="flex-1 min-w-0">
          <textarea
            value={inputText}
            onChange={(e) => onChangeInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isWindowOpen}
            rows={1}
            placeholder={
              isWindowOpen
                ? 'Escreva a resposta — ela sai no WhatsApp exatamente assim'
                : 'A janela de 24h está fechada. Use "Reabrir a conversa" acima para enviar um modelo aprovado.'
            }
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-hidden max-h-32 leading-relaxed"
          />
        </div>

        {/* Botão Gravar Áudio */}
        <button
          type="button"
          onClick={onStartAudioRecord}
          disabled={!isWindowOpen || isSending}
          title="Gravar nota de voz"
          className="p-2 text-zinc-400 hover:text-zinc-100 rounded-xl hover:bg-zinc-700 transition-colors disabled:opacity-30"
        >
          <Mic className="w-4 h-4" />
        </button>

        {/* Botão Enviar */}
        <button
          type="button"
          onClick={onSendTextMessage}
          disabled={!inputText.trim() || isSending || !isWindowOpen}
          className="p-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white rounded-xl transition-colors disabled:opacity-40"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Aviso de Assunção Humana de Controle */}
      <div className="px-2">
        <p className="text-[10px] text-zinc-500 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
          Ao enviar, você assume esta conversa: o agente para de responder aqui até você devolver. As outras seguem normais.
        </p>
      </div>
    </div>
  );
};
