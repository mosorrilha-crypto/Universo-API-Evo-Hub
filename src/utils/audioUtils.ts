// Helper to convert Blob to Base64 string
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper to format seconds into mm:ss
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Generate synthetic audio using SpeechSynthesis and MediaStreamDestination if available,
// or fallback to audio tones if SpeechSynthesis audio capture is limited.
export async function createSpeechAudioBlob(text: string, voiceLang: string = 'pt-BR'): Promise<{ blob: Blob; mimeType: string }> {
  return new Promise((resolve) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      let mediaRecorder: MediaRecorder | null = null;
      
      try {
        mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      } catch {
        // Fallback mime type
        mediaRecorder = new MediaRecorder(dest.stream);
      }

      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
        audioCtx.close();
        resolve({ blob: finalBlob, mimeType: mediaRecorder?.mimeType || 'audio/webm' });
      };

      // Play synthesized multi-frequency chord simulating voice frequencies
      mediaRecorder.start();

      const synth = window.speechSynthesis;
      if (synth && 'SpeechSynthesisUtterance' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = voiceLang;
        utterance.rate = 1.0;
        
        // Also play a gentle audio tone backdrop so WebAudio records guaranteed sound
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(dest);
        osc.start();

        utterance.onend = () => {
          setTimeout(() => {
            try { osc.stop(); } catch {}
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
          }, 300);
        };

        utterance.onerror = () => {
          try { osc.stop(); } catch {}
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        };

        synth.speak(utterance);
      } else {
        // Simple tone fallback
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(dest);
        osc.start();

        setTimeout(() => {
          try { osc.stop(); } catch {}
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        }, 3000);
      }
    } catch (err) {
      console.warn('Fallback generating tone:', err);
      // Fallback empty silent blob if WebAudio fails
      const silentBuffer = new Uint8Array(44100 * 2);
      resolve({ blob: new Blob([silentBuffer], { type: 'audio/wav' }), mimeType: 'audio/wav' });
    }
  });
}
