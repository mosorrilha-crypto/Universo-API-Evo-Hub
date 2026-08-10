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
 * Experimento em andamento (Ogg/Opus → MP3): o formato Ogg/Opus (o único
 * formato de "voice note" de verdade do WhatsApp) foi usado em todas as
 * tentativas anteriores. Confirmamos com certeza — via GET /{media_id} na
 * própria Meta logo após o upload, comparando sha256 — que o arquivo Ogg/Opus
 * chega intacto e é armazenado com o mime_type correto; o erro 131053
 * ("however on processing it is of type application/octet-stream") só
 * aparece DEPOIS, numa etapa de processamento interna da Meta, fora do
 * nosso controle. Trocado aqui pra MP3 (formato de áudio "básico", não gera
 * o visual de nota de voz com waveform) como experimento de controle: se o
 * MP3 também falhar com o mesmo erro, é forte indício de restrição na conta/
 * WABA, não do formato do arquivo.
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
        '-ar', '16000',
        '-b:a', '32k',
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
    // O muxer mp3 do ffmpeg grava um cabeçalho ID3v2 no início do arquivo —
    // confirma aqui mesmo, no ambiente real de produção, que o ffmpeg do
    // Render está de fato produzindo um MP3 válido antes de subir.
    const magic = outputBuffer.subarray(0, 3).toString('ascii');
    console.log(`🎙️  [audioTranscode] input=${inputBuffer.length}B output=${outputBuffer.length}B magic="${magic}" (esperado "ID3")`);
    if (magic !== 'ID3') {
      console.warn(`⚠️  [audioTranscode] Saída do ffmpeg NÃO começa com a assinatura ID3/MP3 — provável causa da rejeição da Meta.`);
    }
    return { base64: outputBuffer.toString('base64'), mimeType: 'audio/mpeg' };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
