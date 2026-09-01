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
export type WhatsAppAudioOutput = 'mp3' | 'ogg_opus';

/**
 * Converte áudio para o formato de entrega escolhido. MP3 é o padrão estável;
 * OGG/Opus só deve ser solicitado pelo ensaio controlado autenticado.
 */
export async function transcodeToWhatsAppVoiceNote(
  base64: string,
  mimeType: string,
  output: WhatsAppAudioOutput = 'mp3'
): Promise<{ base64: string; mimeType: string }> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg não disponível neste ambiente — não foi possível converter o áudio pro formato aceito pela Meta.');
  }

  const cleanBase64 = stripDataUrlPrefix(base64);
  const inputBuffer = Buffer.from(cleanBase64, 'base64');

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(tmpDir, `voice-in-${id}`);
  const outputMimeType = output === 'ogg_opus' ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
  const outputPath = path.join(tmpDir, `voice-out-${id}.${output === 'ogg_opus' ? 'ogg' : 'mp3'}`);
  const ffmpegArgs = output === 'ogg_opus'
    ? [
        '-y', '-i', inputPath, '-vn',
        '-c:a', 'libopus', '-ac', '1', '-ar', '16000', '-b:a', '24k',
        '-vbr', 'on', '-application', 'voip', '-f', 'ogg', outputPath,
      ]
    : [
        '-y', '-i', inputPath, '-vn',
        '-c:a', 'libmp3lame', '-ac', '1', '-ar', '48000', '-b:a', '64k',
        '-f', 'mp3', outputPath,
      ];

  await fs.writeFile(inputPath, inputBuffer);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as unknown as string, ffmpegArgs);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg falhou (código ${code}): ${stderr.slice(-500)}`));
      });
    });

    const outputBuffer = await fs.readFile(outputPath);
    const magic = outputBuffer.subarray(0, 4).toString('ascii');
    const hasOpusHeader = outputBuffer.includes(Buffer.from('OpusHead'));
    if (output === 'ogg_opus') {
      console.log('🎙️  [audioTranscode] probe=ogg_opus', { inputBytes: inputBuffer.length, outputBytes: outputBuffer.length, magic, opus: hasOpusHeader });
      if (magic !== 'OggS' || !hasOpusHeader) {
        throw new Error('A conversão de áudio não produziu um OGG/Opus válido.');
      }
    } else {
      console.log('🎙️  [audioTranscode] fallback=mp3', { inputBytes: inputBuffer.length, outputBytes: outputBuffer.length, magic: magic.slice(0, 3), esperado: 'ID3' });
      if (magic.slice(0, 3) !== 'ID3') {
        throw new Error('A conversão de áudio não produziu um MP3 válido.');
      }
    }
    return { base64: outputBuffer.toString('base64'), mimeType: outputMimeType };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Achado real de produção (29/08/2026): mesmo com a regra explícita no
 * prompt do Gemini pra devolver `transcription: ""` sem fala real (ver
 * geminiTranscription.ts), um áudio de 2s genuinamente sem fala voltou com
 * uma transcrição completa e plausível inventada — a instrução de prompt
 * sozinha não é confiável (o mesmo princípio de todo outro gate anti-
 * alucinação deste projeto: nunca confiar só no modelo se auto-policiar
 * quando dá pra checar de forma determinística). Usa o filtro
 * `silencedetect` do próprio ffmpeg (já uma dependência do projeto) pra
 * medir quanto do áudio é silêncio de verdade, independente do que o
 * Gemini disser — se quase tudo for silêncio, a chamada ao Gemini nem
 * acontece, fechando a via de alucinação pro caso mais comum (áudio vazio
 * gravado sem querer). Áudio com fala real, mesmo curta, nunca passa aqui:
 * o teste com um tom de 2s (não-silêncio) não gera nenhuma linha
 * "silence_*" no stderr do ffmpeg.
 */
const SILENCE_NOISE_THRESHOLD_DB = -30;
const SILENCE_MIN_SEGMENT_SECONDS = 0.2;
/** Fração do áudio que precisa ser silêncio pra considerar "sem fala real". Folga proposital abaixo de 100% pra tolerar um clique/respiração captada no início/fim de uma gravação vazia. */
const SILENCE_RATIO_THRESHOLD = 0.92;

async function runFfmpegSilenceDetect(inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, [
      '-i', inputPath,
      '-af', `silencedetect=noise=${SILENCE_NOISE_THRESHOLD_DB}dB:d=${SILENCE_MIN_SEGMENT_SECONDS}`,
      '-f', 'null', '-',
    ]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    // ffmpeg com -f null sempre sai com código 0 quando consegue decodificar
    // o áudio até o fim — só o stderr importa aqui, nunca há arquivo de saída.
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg (silencedetect) falhou (código ${code}): ${stderr.slice(-500)}`));
    });
  });
}

/**
 * `true` quando o áudio é, na prática, silêncio inteiro (sem fala real
 * detectável) — usado como barreira determinística ANTES de mandar o áudio
 * pro Gemini transcrever, pra nunca depender só da instrução de prompt.
 * Fail-open por design: qualquer problema pra decidir (ffmpeg indisponível,
 * áudio corrompido, formato não reconhecido) devolve `false` — nunca bloqueia
 * um áudio real por falha da própria checagem.
 */
export async function isAudioEffectivelySilent(base64: string, mimeType?: string): Promise<boolean> {
  if (!ffmpegPath) return false;

  const cleanBase64 = stripDataUrlPrefix(base64);
  let inputBuffer: Buffer;
  try {
    inputBuffer = Buffer.from(cleanBase64, 'base64');
  } catch {
    return false;
  }
  if (!inputBuffer.length) return false;

  // Achado do CodeQL neste PR (js/insecure-temporary-file, high +
  // js/tainted-write-file-path-followed-by-request-forgery-like flow,
  // medium): `path.join(os.tmpdir(), nome-previsível)` seguido de
  // `fs.writeFile` não é atômico — em tese um processo concorrente no
  // mesmo host poderia prever/pré-criar esse caminho antes da escrita
  // (TOCTOU). `fs.mkdtemp` cria o diretório de forma atômica com sufixo
  // aleatório garantido pelo próprio Node (falha se já existir), sem essa
  // janela de corrida — é o padrão reconhecido pra isso.
  let tmpParentDir: string | undefined;

  try {
    tmpParentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'silence-check-'));
    const inputPath = path.join(tmpParentDir, 'input');
    await fs.writeFile(inputPath, inputBuffer);
    const stderr = await runFfmpegSilenceDetect(inputPath);

    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!durationMatch) return false; // não deu pra medir a duração real — não bloqueia por falta de dado.
    const totalSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
    if (!(totalSeconds > 0)) return false;

    const silenceDurations = [...stderr.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    let silentSeconds = silenceDurations.reduce((sum, value) => sum + value, 0);

    // Silêncio que já começou mas nunca fechou (o áudio termina em silêncio,
    // sem mais nenhum som depois) não gera "silence_duration" nenhuma — soma
    // o trecho do último "silence_start" sem par até o fim do áudio.
    const startMatches = [...stderr.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)];
    const endMatches = [...stderr.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)];
    if (startMatches.length > endMatches.length) {
      const lastStart = Number(startMatches[startMatches.length - 1][1]);
      silentSeconds += Math.max(0, totalSeconds - lastStart);
    }

    return silentSeconds / totalSeconds >= SILENCE_RATIO_THRESHOLD;
  } catch (err) {
    console.warn('⚠️  [audioTranscode] Falha ao checar silêncio do áudio (seguindo sem bloquear):', (err as Error)?.message || err);
    return false;
  } finally {
    if (tmpParentDir) await fs.rm(tmpParentDir, { recursive: true, force: true }).catch(() => {});
  }
}
