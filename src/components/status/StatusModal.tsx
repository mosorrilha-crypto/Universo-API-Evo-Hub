import React from 'react';
import { CircleDashed, Image as ImageIcon, Video, X } from 'lucide-react';

interface StatusModalProps {
  isOpen: boolean;
  error: string | null;
  isPosting: boolean;
  text: string;
  onTextChange: (value: string) => void;
  backgroundColor: string;
  onBackgroundColorChange: (value: string) => void;
  imageBase64: string | null;
  imageFileName: string;
  onClearImage: () => void;
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  videoBase64: string | null;
  videoFileName: string;
  onClearVideo: () => void;
  onVideoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  isOpen, error, isPosting,
  text, onTextChange, backgroundColor, onBackgroundColorChange,
  imageBase64, imageFileName, onClearImage, onImageSelect,
  videoBase64, videoFileName, onClearVideo, onVideoSelect,
  caption, onCaptionChange,
  onSubmit, onClose,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <CircleDashed className="w-5 h-5 text-emerald-400" />
          Postar Status
        </h3>
        <p className="text-xs text-slate-400">
          Vai pro Status do WhatsApp da empresa, visível pra todos os contatos — bom pra foto de antes/depois de procedimento ou aviso rápido.
        </p>

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{error}</div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          {imageBase64 ? (
            <div className="space-y-2">
              <div className="relative rounded-xl overflow-hidden border border-slate-800">
                <img src={imageBase64} alt={imageFileName} className="w-full max-h-48 object-cover" />
                <button
                  type="button"
                  onClick={onClearImage}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-950/80 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Legenda (opcional)"
                value={caption}
                onChange={(e) => onCaptionChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          ) : videoBase64 ? (
            <div className="space-y-2">
              <div className="relative rounded-xl overflow-hidden border border-slate-800">
                <video src={videoBase64} controls className="w-full max-h-48 object-cover" />
                <button
                  type="button"
                  onClick={onClearVideo}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-950/80 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Legenda (opcional)"
                value={caption}
                onChange={(e) => onCaptionChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          ) : (
            <>
              <textarea
                placeholder="Escreva o texto do Status..."
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none resize-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-medium text-slate-300">Cor de fundo</label>
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => onBackgroundColorChange(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-slate-800 bg-slate-950 cursor-pointer"
                />
                <span className="text-slate-500 text-xs">ou</span>
                <label className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer">
                  <ImageIcon className="w-3.5 h-3.5" /> Usar foto
                  <input type="file" accept="image/*" className="hidden" onChange={onImageSelect} />
                </label>
                <label className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 flex items-center gap-1.5 cursor-pointer">
                  <Video className="w-3.5 h-3.5" /> Usar vídeo
                  <input type="file" accept="video/*" className="hidden" onChange={onVideoSelect} />
                </label>
              </div>
            </>
          )}

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
              disabled={isPosting || (!text.trim() && !imageBase64 && !videoBase64)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md shadow-emerald-950 flex items-center space-x-1 cursor-pointer"
            >
              <CircleDashed className="w-3.5 h-3.5 mr-1" />
              <span>{isPosting ? 'Postando...' : 'Postar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
