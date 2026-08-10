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
 * passa por aqui antes de subir. O único formato garantido de funcionar como
 * nota de voz é Ogg com codec Opus, mono.
 */
export async function transcodeToWhatsAppVoiceNote(
  base64: string,
  mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg não disponível neste ambiente — não foi possível converter o áudio pro formato aceito pela Meta.');
  }

  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const inputBuffer = Buffer.from(cleanBase64, 'base64');

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(tmpDir, `voice-in-${id}`);
  const outputPath = path.join(tmpDir, `voice-out-${id}.ogg`);

  await fs.writeFile(inputPath, inputBuffer);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as unknown as string, [
        '-y',
        '-i', inputPath,
        '-vn',
        '-c:a', 'libopus',
        '-ac', '1',
        '-ar', '16000', // Frequência padrão para notas de voz no WhatsApp
        '-b:a', '32k',
        '-f', 'ogg',
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
    // Diagnóstico temporário (achado real: a Meta reporta "processing it is
    // of type application/octet-stream" mesmo com Content-Type/filename
    // corretos) — confirma aqui mesmo, no ambiente real de produção, se o
    // ffmpeg do Render está de fato produzindo um Ogg válido (assinatura
    // "OggS" nos primeiros 4 bytes) antes de sequer chegar no upload.
    const magic = outputBuffer.subarray(0, 4).toString('ascii');
    console.log(`🎙️  [audioTranscode] input=${inputBuffer.length}B output=${outputBuffer.length}B magic="${magic}" (esperado "OggS")`);
    if (magic !== 'OggS') {
      console.warn(`⚠️  [audioTranscode] Saída do ffmpeg NÃO começa com a assinatura Ogg — provável causa da rejeição da Meta.`);
    }
    return { base64: outputBuffer.toString('base64'), mimeType: 'audio/ogg; codecs=opus' };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
