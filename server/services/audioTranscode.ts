import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
// @ts-ignore — ffmpeg-static não publica tipos, só o caminho do binário via default export.
import ffmpegPath from 'ffmpeg-static';

/**
 * Achado real em produção ("o áudio sai mas não chega"): o navegador grava um
 * áudio (webm, ou mp4 com codec Opus dentro — Chrome reporta "audio/mp4"
 * como suportado, mas o MediaRecorder produz Opus-em-MP4, não AAC-em-MP4). A
 * Meta ACEITA o upload em qualquer um desses casos (retorna 200, nossa UI
 * mostra ✓✓), mas nunca toca como nota de voz de verdade no WhatsApp do
 * cliente — falha silenciosa sem erro nenhum de volta. Não dá pra confiar no
 * mimeType que o navegador reporta pra decidir se pula a conversão (já foi
 * tentado e ainda falhava ao vivo) — todo áudio gravado no navegador sempre
 * passa por aqui antes de subir.
 *
 * Causa confirmada para OGG gravado no painel: FileReader produz um Data URL
 * como `data:audio/ogg;codecs=opus;base64,...`, mas a limpeza anterior só
 * reconhecia tipos sem parâmetros. O prefixo permanecia no texto convertido
 * por Buffer e corrompia o início do binário antes do ffmpeg.
 *
 * Fallback provisório: apesar de OGG/Opus válido, a entrega chega como arquivo
 * e com qualidade inadequada no destinatário. Até a investigação com a Meta
 * ser concluída, a saída é MP3 mono de 48 kHz a 64 kbps (áudio básico),
 * priorizando entrega, reprodução e qualidade de voz. A limpeza do Data URL
 * permanece para a futura retomada do OGG.
 */

/** Remove o cabeçalho de um Data URL sem perder parâmetros como codecs=opus. */
export function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:[^,]*;base64,/i, '');
}
export async function transcodeToWhatsAppVoiceNote(
  base64: string,
  mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg não disponível neste ambiente — não foi possível converter o áudio pro formato aceito pela Meta.');
  }

  const cleanBase64 = stripDataUrlPrefix(base64);
  const inputBuffer = Buffer.from(cleanBase64, 'base64');

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(tmpDir, `voice-in-${id}`);
  const outputPath = path.join(tmpDir, `voice-out-${id}.mp3`);

  await fs.writeFile(inputPath, inputBuffer);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as unknown as string, [
        '-y',
        '-i', inputPath,
        '-vn',
        '-c:a', 'libmp3lame',
        '-ac', '1',
        '-ar', '48000',
        '-b:a', '64k',
        '-f', 'mp3',
        outputPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg falhou (código ${code}): ${stderr.slice(-500)}`));
      });
    });

    const outputBuffer = await fs.readFile(outputPath);
    const magic = outputBuffer.subarray(0, 3).toString('ascii');
    console.log(`🎙️  [audioTranscode] fallback=mp3 input=${inputBuffer.length}B output=${outputBuffer.length}B magic="${magic}" (esperado "ID3")`);
    if (magic !== 'ID3') {
      throw new Error('A conversão de áudio não produziu um MP3 válido.');
    }
    return { base64: outputBuffer.toString('base64'), mimeType: 'audio/mpeg' };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
