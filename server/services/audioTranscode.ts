import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
// @ts-ignore — ffmpeg-static não publica tipos, só o caminho do binário via default export.
import ffmpegPath from 'ffmpeg-static';

/**
 * Formatos que a Meta Cloud API realmente aceita E reproduz como nota de voz.
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
const META_ACCEPTED_AUDIO_PREFIXES = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'];

export function isMetaAcceptedAudioMimeType(mimeType: string): boolean {
  return META_ACCEPTED_AUDIO_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

/**
 * Achado real em produção ("o áudio sai mas não chega"): o navegador (Chrome,
 * o mais comum) grava em audio/webm — a Meta ACEITA o upload desse container
 * (retorna 200, nossa UI mostra ✓✓), mas nunca toca como nota de voz de
 * verdade no WhatsApp do cliente, uma falha silenciosa sem erro nenhum de
 * volta. O único formato garantido de funcionar como nota de voz é Ogg com
 * codec Opus, mono — reencoda pra esse formato antes de subir, em vez de só
 * rejeitar o upload (como a checagem anterior fazia) ou torcer pra Meta
 * aceitar o container errado.
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
    return { base64: outputBuffer.toString('base64'), mimeType: 'audio/ogg' };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
