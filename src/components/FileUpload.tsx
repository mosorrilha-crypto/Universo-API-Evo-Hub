import React, { useState } from 'react';
import { blobToBase64 } from '../utils/audioUtils';
import { apiFetch } from '../lib/apiClient';
import { TranscriptionResult, SavedTranscriptItem } from '../types';
import { TranscriptionCard } from './TranscriptionCard';
import { Upload, FileAudio, Sparkles, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface FileUploadProps {
  onSaveTranscript: (item: SavedTranscriptItem) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onSaveTranscript }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileAudioUrl, setFileAudioUrl] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileChange = (file: File) => {
    if (!file.type.startsWith('audio/') && !file.name.endsWith('.ogg') && !file.name.endsWith('.opus')) {
      setErrorMsg('Por favor selecione um arquivo de áudio válido (.ogg, .opus, .mp3, .wav, .m4a, .webm).');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg('O tamanho do arquivo não pode exceder 25MB.');
      return;
    }

    setErrorMsg(null);
    setTranscriptionResult(null);
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setFileAudioUrl(url);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleTranscribeFile = async () => {
    if (!selectedFile) return;
    setIsTranscribing(true);
    setErrorMsg(null);

    try {
      const base64Data = await blobToBase64(selectedFile);
      const mimeType = selectedFile.type || 'audio/ogg';

      const response = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Data,
          mimeType: mimeType,
          leadName: selectedFile.name,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao processar transcrição do arquivo.');
      }

      const res: TranscriptionResult = data.result;
      setTranscriptionResult(res);

      const savedItem: SavedTranscriptItem = {
        id: `file-${Date.now()}`,
        title: selectedFile.name,
        source: 'file_upload',
        audioUrl: fileAudioUrl || undefined,
        audioDuration: 0,
        mimeType: mimeType,
        createdAt: new Date().toLocaleString('pt-BR'),
        result: res,
      };

      onSaveTranscript(savedItem);
    } catch (err: any) {
      console.error('Erro ao transcrever arquivo:', err);
      setErrorMsg(err.message || 'Falha na transcrição do arquivo de áudio.');
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 sm:p-8 shadow-xl">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-2">Upload de Áudios do WhatsApp (.ogg, .opus, .mp3, .wav)</h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
            Faça upload do arquivo de nota de voz enviado pelo cliente. O WhatsApp utiliza nativamente os formatos OGG e OPUS.
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
            dragActive
              ? 'border-emerald-500 bg-emerald-500/10'
              : selectedFile
              ? 'border-emerald-500/50 bg-slate-950/60'
              : 'border-slate-700 hover:border-slate-600 bg-slate-950/40'
          }`}
        >
          <input
            id="file-input-audio"
            type="file"
            accept="audio/*,.ogg,.opus,.mp3,.wav,.m4a,.webm"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            className="hidden"
          />

          <label htmlFor="file-input-audio" className="cursor-pointer block">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-4 text-emerald-400 shadow-inner">
              <Upload className="w-8 h-8" />
            </div>

            {selectedFile ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  {selectedFile.name}
                </p>
                <p className="text-xs text-slate-400">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || 'audio/ogg'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-200 mb-1">
                  Arraste e solte o arquivo de áudio aqui ou <span className="text-emerald-400 underline">clique para procurar</span>
                </p>
                <p className="text-xs text-slate-500">
                  Suporta formatos de nota de voz do WhatsApp: .OGG, .OPUS, .MP3, .WAV, .M4A
                </p>
              </div>
            )}
          </label>
        </div>

        {/* Preview Audio Player & Transcribe Button */}
        {selectedFile && fileAudioUrl && (
          <div className="mt-6 pt-6 border-t border-slate-800 space-y-4 max-w-md mx-auto">
            <audio controls src={fileAudioUrl} className="w-full h-10 rounded-lg" />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setFileAudioUrl(null);
                  setTranscriptionResult(null);
                }}
                className="px-4 py-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <button
                id="btn-transcribe-file"
                onClick={handleTranscribeFile}
                disabled={isTranscribing}
                className="flex-1 py-3 px-6 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/50 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Transcrevendo Arquivo com IA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 text-emerald-200" />
                    <span>Transcrever Arquivo</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2 text-left max-w-md mx-auto">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {transcriptionResult && (
        <TranscriptionCard
          result={transcriptionResult}
          audioUrl={fileAudioUrl || undefined}
          title={`Transcrição do Arquivo: ${selectedFile?.name}`}
        />
      )}
    </div>
  );
};
