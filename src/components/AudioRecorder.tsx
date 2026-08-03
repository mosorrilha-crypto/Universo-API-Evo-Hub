import React, { useState, useRef, useEffect } from 'react';
import { blobToBase64 } from '../utils/audioUtils';
import { TranscriptionResult, SavedTranscriptItem } from '../types';
import { TranscriptionCard } from './TranscriptionCard';
import { Mic, Square, Play, RefreshCw, Sparkles, Loader2, Volume2, AlertCircle } from 'lucide-react';

interface AudioRecorderProps {
  onSaveTranscript: (item: SavedTranscriptItem) => void;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onSaveTranscript }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('audio/webm');
  
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio Context & MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Visualizer loop for Canvas
  const startVisualizer = (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          
          // Emerald gradient bar
          const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
          gradient.addColorStop(0, '#10b981');
          gradient.addColorStop(1, '#34d399');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);

          x += barWidth;
        }
      };

      draw();
    } catch (e) {
      console.warn('Visualizer warning:', e);
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setTranscriptionResult(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let detectedMime = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        detectedMime = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        detectedMime = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        detectedMime = 'audio/ogg';
      }

      setMimeType(detectedMime);

      const mediaRecorder = new MediaRecorder(stream, { mimeType: detectedMime });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const recordedBlob = new Blob(audioChunksRef.current, { type: detectedMime });
        const url = URL.createObjectURL(recordedBlob);
        setAudioBlob(recordedBlob);
        setAudioUrl(url);

        // Stop media stream tracks
        stream.getTracks().forEach((track) => track.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      startVisualizer(stream);

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Erro ao acessar microfone:', err);
      setErrorMsg('Não foi possível acessar o microfone. Verifique as permissões do seu navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;
    setIsTranscribing(true);
    setErrorMsg(null);

    try {
      const base64Audio = await blobToBase64(audioBlob);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: mimeType,
          leadName: 'Gravação via Microfone',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro no servidor de transcrição.');
      }

      const res: TranscriptionResult = data.result;
      setTranscriptionResult(res);

      // Save to global history
      const savedItem: SavedTranscriptItem = {
        id: `rec-${Date.now()}`,
        title: `Gravação de Voz (${recordingTime}s)`,
        source: 'microphone',
        audioUrl: audioUrl || undefined,
        audioDuration: recordingTime,
        mimeType: mimeType,
        createdAt: new Date().toLocaleString('pt-BR'),
        result: res,
      };

      onSaveTranscript(savedItem);
    } catch (err: any) {
      console.error('Erro de transcrição:', err);
      setErrorMsg(err.message || 'Ocorreu um erro ao transcrever o áudio com a API Gemini.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Recorder Controls Box */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 sm:p-8 text-center shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
          <Mic className="w-32 h-32 text-emerald-400" />
        </div>

        <h2 className="text-xl font-bold text-white mb-2">Gravador de Voz via Microfone</h2>
        <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto mb-6">
          Grave um áudio de teste com seu microfone. O Gemini 3.6 Flash fará a transcrição exata, resumo e gerará uma sugestão de resposta.
        </p>

        {/* Audio Visualizer Canvas */}
        <div className="w-full max-w-md mx-auto h-20 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-center p-2 mb-6 shadow-inner relative">
          <canvas ref={canvasRef} width={380} height={60} className="w-full h-full" />
          {!isRecording && !audioUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 font-medium">
              <Volume2 className="w-4 h-4 mr-1.5 text-slate-600" />
              Clique em "Iniciar Gravação" para usar o microfone
            </div>
          )}
        </div>

        {/* Timer Display */}
        <div className="text-3xl font-mono font-bold text-emerald-400 mb-6 tracking-wider">
          {formatTime(recordingTime)}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {!isRecording ? (
            <button
              id="start-mic-record-btn"
              onClick={startRecording}
              disabled={isTranscribing}
              className="inline-flex items-center px-6 py-3 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
            >
              <Mic className="w-5 h-5 mr-2 animate-pulse" />
              <span>Iniciar Gravação</span>
            </button>
          ) : (
            <button
              id="stop-mic-record-btn"
              onClick={stopRecording}
              className="inline-flex items-center px-6 py-3 rounded-xl font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/50 transition-all cursor-pointer"
            >
              <Square className="w-5 h-5 mr-2 fill-current" />
              <span>Parar Gravação</span>
            </button>
          )}

          {audioUrl && !isRecording && (
            <button
              onClick={() => {
                setAudioUrl(null);
                setAudioBlob(null);
                setTranscriptionResult(null);
                setRecordingTime(0);
              }}
              className="inline-flex items-center px-4 py-3 rounded-xl font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              <span>Nova Gravação</span>
            </button>
          )}
        </div>

        {/* Audio Player Preview */}
        {audioUrl && !isRecording && (
          <div className="mt-6 pt-6 border-t border-slate-800/80 max-w-md mx-auto">
            <p className="text-xs text-slate-400 mb-2 font-medium flex items-center justify-center">
              <Play className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              Ouvir gravação antes de transcrever:
            </p>
            <audio controls src={audioUrl} className="w-full h-10 rounded-lg" />

            <button
              id="btn-transcribe-mic"
              onClick={handleTranscribe}
              disabled={isTranscribing}
              className="w-full mt-4 py-3 px-6 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/50 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Transcrevendo com Gemini IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-emerald-200" />
                  <span>Transcrever com Gemini 3.6 Flash</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2 text-left max-w-md mx-auto">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Result Card */}
      {transcriptionResult && (
        <TranscriptionCard
          result={transcriptionResult}
          audioUrl={audioUrl || undefined}
          title="Transcrição do Microfone"
        />
      )}
    </div>
  );
};
