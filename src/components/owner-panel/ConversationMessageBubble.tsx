import React from 'react';
import { Play, Pause, FileText, CheckCheck, User, Bot, AlertCircle } from 'lucide-react';
import type { ChatMessage } from '../../types';

interface ConversationMessageBubbleProps {
  message: ChatMessage;
  contactName: string;
  onImageClick?: (url: string) => void;
  onRetry?: (messageId: string) => void;
}

export const ConversationMessageBubble: React.FC<ConversationMessageBubbleProps> = ({
  message,
  contactName,
  onImageClick,
  onRetry,
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = React.useState(false);
  // Duração/posição real do <audio>, não um valor fixo — achado real de
  // auditoria: mostrava "0:15" pra qualquer áudio e a barra de progresso era
  // uma transição CSS de 3s fixa, sem relação com o áudio de verdade.
  const [audioDurationSec, setAudioDurationSec] = React.useState<number | null>(null);
  const [audioCurrentSec, setAudioCurrentSec] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const isUser = message.sender === 'user' || message.sender === 'lead';
  const isAgent = message.sender === 'agent';
  const isOperator = isAgent && message.sent_by === 'operator';
  const isSystem = message.sender === 'system';

  const formatAudioTime = (totalSeconds: number) => {
    const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds >= 0 ? totalSeconds : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = Math.floor(safeSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  // Pré-carrega metadata (duração real) assim que a mensagem de áudio
  // aparece, sem esperar o clique em play — evita mostrar "--:--" à toa.
  React.useEffect(() => {
    if (message.type !== 'audio' || !message.mediaUrl) return;
    const audio = new Audio(message.mediaUrl);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) setAudioDurationSec(audio.duration);
    };
    audio.ontimeupdate = () => setAudioCurrentSec(audio.currentTime);
    audio.onended = () => {
      setIsPlayingAudio(false);
      setAudioCurrentSec(0);
    };
    audio.onerror = () => setIsPlayingAudio(false);
    audioRef.current = audio;
    setAudioDurationSec(null);
    setAudioCurrentSec(0);
    setIsPlayingAudio(false);

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [message.type, message.mediaUrl]);

  const togglePlayAudio = (audioUrl?: string) => {
    if (!audioUrl || !audioRef.current) return;
    if (isPlayingAudio) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioRef.current.play().then(() => setIsPlayingAudio(true)).catch(() => setIsPlayingAudio(false));
    }
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{message.text}</span>
        </div>
      </div>
    );
  }

  // Estilo e posicionamento do balão
  // Cliente: Esquerda (Fundo neutro claro)
  // Agente: Direita (Verde clássico WhatsApp)
  // Operador: Direita (Tom quente/pêssego distintivo com etiqueta "ESCRITA POR VOCÊ")
  return (
    <div className={`flex flex-col my-1.5 max-w-[82%] sm:max-w-[72%] ${isUser ? 'mr-auto items-start' : 'ml-auto items-end'}`}>
      {/* Nome do remetente no topo da mensagem */}
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        {isUser ? (
          <span className="text-[11px] font-semibold text-zinc-400">{contactName}</span>
        ) : isOperator ? (
          <span className="text-[11px] font-bold text-amber-400/90 flex items-center gap-1">
            <User className="w-3 h-3" />
            Você (equipe)
          </span>
        ) : (
          <span className="text-[11px] font-medium text-emerald-400/90 flex items-center gap-1">
            <Bot className="w-3 h-3" />
            Atendente
          </span>
        )}
      </div>

      {/* Caixa da Mensagem */}
      <div
        className={`relative px-3.5 py-2 rounded-2xl shadow-sm text-sm transition-all ${
          isUser
            ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm border border-zinc-700/60'
            : isOperator
            ? 'bg-[#2e261f] text-amber-50 rounded-tr-sm border border-amber-600/30'
            : 'bg-[#183628] text-emerald-50 rounded-tr-sm border border-emerald-600/30'
        }`}
      >
        {/* Renderização de Imagem */}
        {message.type === 'image' && message.mediaUrl && (
          <div className="mb-2 overflow-hidden rounded-xl cursor-pointer">
            <img
              src={message.mediaUrl}
              alt="Mídia da conversa"
              className="max-h-64 w-auto object-cover rounded-lg hover:opacity-90 transition-opacity"
              onClick={() => onImageClick && onImageClick(message.mediaUrl!)}
            />
          </div>
        )}

        {/* Renderização de Documento */}
        {message.type === 'document' && (
          <div className="flex items-center gap-2 p-2 bg-black/20 rounded-xl mb-1.5 border border-white/5">
            <FileText className="w-5 h-5 text-zinc-400" />
            <span className="text-xs font-medium truncate max-w-[200px]">
              {message.fileName || 'Documento anexado'}
            </span>
          </div>
        )}

        {/* Renderização de Áudio */}
        {message.type === 'audio' && (
          <div className="flex flex-col gap-1.5 min-w-[220px]">
            <div className="flex items-center gap-2.5 py-1">
              <button
                type="button"
                onClick={() => togglePlayAudio(message.mediaUrl)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                {isPlayingAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400"
                  style={{
                    width: audioDurationSec ? `${Math.min(100, (audioCurrentSec / audioDurationSec) * 100)}%` : '0%',
                  }}
                />
              </div>
              <span className="text-[11px] text-zinc-400">
                {audioDurationSec ? formatAudioTime(isPlayingAudio ? audioCurrentSec : audioDurationSec) : '--:--'}
              </span>
            </div>

            {/* Transcrição de áudio se existir */}
            {message.transcription && (
              <div className="text-[12px] text-zinc-300 bg-black/20 rounded-lg p-2 border border-white/5 italic">
                <span className="font-semibold text-emerald-400 not-italic block mb-0.5">
                  [Áudio do cliente — transcrição]
                </span>
                {message.transcription}
              </div>
            )}
          </div>
        )}

        {/* Texto da mensagem */}
        {message.text && (
          <p className="whitespace-pre-wrap leading-relaxed select-text">
            {message.text}
          </p>
        )}

        {/* Rodapé do Balão: Timestamp + Rótulo "ESCRITA POR VOCÊ" / Checkmarks */}
        <div className="flex items-center justify-end gap-1.5 mt-1 pt-0.5">
          {isOperator && (
            <span className="text-[9px] font-extrabold tracking-wider text-amber-400/90 uppercase mr-1">
              ESCRITA POR VOCÊ
            </span>
          )}
          <span className="text-[10px] text-zinc-400/80">
            {message.timestamp}
          </span>
          {!isUser && (
            <CheckCheck className={`w-3.5 h-3.5 ${message.deliveryStatus === 'read' ? 'text-sky-400' : 'text-zinc-400'}`} />
          )}
        </div>
      </div>
    </div>
  );
};
