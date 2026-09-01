import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
// @ts-ignore — ffmpeg-static não publica tipos, só o caminho do binário via default export.
import ffmpegPath from 'ffmpeg-static';

/**
 * Converte um vídeo de produto/serviço pra MP4 (H.264/AAC) — o único par de
 * codec/container que a Meta Cloud API garante aceitar pra mensagem de
 * vídeo do WhatsApp (video/mp4, além de video/3gpp). Pedido real do dono do
 * produto: aceitar .MOV (o formato padrão do iPhone, mimeType
 * "video/quicktime") em vez de exigir que o operador converta na mão antes
 * de subir. Mesmo padrão de audioTranscode.ts (ffmpeg-static + arquivo
 * temporário) — nunca falha silenciosamente, sempre confirma o resultado.
 *
 * "-profile:v baseline -level 3.0" garante compatibilidade ampla (o mesmo
 * H.264 "alto" que o ffmpeg escolhe por padrão pra fontes 4K/HDR do iPhone
 * às vezes usa recursos que a validação de mídia da própria Meta rejeita).
 * "-movflags +faststart" move o índice do MP4 pro início do arquivo — sem
 * isso, alguns players (incluindo o preview de vídeo dentro do WhatsApp)
 * ficam com a barra de carregamento travada até o arquivo inteiro chegar.
 */
export async function transcodeToWhatsAppVideo(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg não disponível neste ambiente — não foi possível converter o vídeo pro formato aceito pela Meta.');
  }

  const inputExt = (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';

  // Achado do CodeQL (js/insecure-temporary-file, High): `path.join(os.tmpdir(),
  // nome-previsível)` seguido de `fs.writeFile` não é atômico — em tese um
  // processo concorrente no mesmo host poderia prever/pré-criar esse caminho
  // antes da escrita (TOCTOU). `fs.mkdtemp` cria o diretório de forma atômica
  // com sufixo aleatório garantido pelo próprio Node (falha se já existir),
  // sem essa janela de corrida — mesmo padrão já usado em
  // `isAudioEffectivelySilent` (audioTranscode.ts).
  const tmpParentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-transcode-'));
  const inputPath = path.join(tmpParentDir, `input.${inputExt}`);
  const outputPath = path.join(tmpParentDir, 'output.mp4');

  await fs.writeFile(inputPath, buffer);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as unknown as string, [
        '-y',
        '-i', inputPath,
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-f', 'mp4',
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
    if (outputBuffer.length === 0) {
      throw new Error('ffmpeg produziu um arquivo de saída vazio.');
    }
    console.log(`🎬 [videoTranscode] input=${buffer.length}B (${mimeType}) output=${outputBuffer.length}B (video/mp4)`);
    return { buffer: outputBuffer, mimeType: 'video/mp4' };
  } finally {
    await fs.rm(tmpParentDir, { recursive: true, force: true }).catch(() => {});
  }
}
