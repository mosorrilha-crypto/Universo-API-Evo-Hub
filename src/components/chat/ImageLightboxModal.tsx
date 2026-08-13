import React from 'react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <div
      className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 cursor-pointer"
      onClick={onClose}
    >
      <div className="relative max-w-3xl w-full max-h-[90vh] flex items-center justify-center">
        <img
          src={imageUrl}
          alt="Mídia expandida"
          className="max-w-full max-h-[85vh] rounded-2xl border border-slate-700 shadow-2xl object-contain"
        />
        <span className="absolute top-2 right-2 text-white bg-slate-900/80 px-3 py-1 rounded-xl text-xs font-bold border border-slate-700">
          Clique em qualquer lugar para fechar
        </span>
      </div>
    </div>
  );
};
