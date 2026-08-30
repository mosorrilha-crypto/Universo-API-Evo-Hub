/**
 * Achado real de produção (29/08/2026): mesmo com a instrução explícita no
 * prompt do Gemini pra nunca inventar fala, um áudio de 2s genuinamente sem
 * fala voltou com uma transcrição completa e plausível inventada. Instrução
 * de prompt sozinha não é confiável — isAudioEffectivelySilent (ffmpeg
 * silencedetect) existe como barreira determinística antes de mandar
 * qualquer áudio pro Gemini. Estes testes usam ffmpeg de verdade (já uma
 * dependência do projeto, ffmpeg-static) pra gerar áudio sintético — sem
 * mockar o próprio mecanismo que estamos validando.
 */
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { describe, expect, it, beforeAll } from 'vitest';
// @ts-ignore — ffmpeg-static não publica tipos.
import ffmpegPath from 'ffmpeg-static';
import { isAudioEffectivelySilent } from '../audioTranscode';

let silentAudioBase64: string;
let toneAudioBase64: string;
let ffmpegAvailable = true;

function generateOggWithFfmpeg(filterArgs: string[]): string {
  const tmpFile = path.join(os.tmpdir(), `audio-silence-test-${crypto.randomBytes(6).toString('hex')}.ogg`);
  const result = spawnSync(ffmpegPath as unknown as string, ['-y', ...filterArgs, '-c:a', 'libopus', '-f', 'ogg', tmpFile]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg falhou ao gerar áudio de teste: ${result.stderr?.toString().slice(-500)}`);
  }
  return tmpFile;
}

beforeAll(async () => {
  try {
    execFileSync(ffmpegPath as unknown as string, ['-version']);
  } catch {
    ffmpegAvailable = false;
    return;
  }

  const silentPath = generateOggWithFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2']);
  const tonePath = generateOggWithFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']);

  silentAudioBase64 = (await fs.readFile(silentPath)).toString('base64');
  toneAudioBase64 = (await fs.readFile(tonePath)).toString('base64');

  await fs.unlink(silentPath).catch(() => {});
  await fs.unlink(tonePath).catch(() => {});
});

describe('isAudioEffectivelySilent', () => {
  it('detecta um áudio de 2s inteiramente silencioso (achado real: gravação vazia do operador)', async () => {
    if (!ffmpegAvailable) return;
    await expect(isAudioEffectivelySilent(silentAudioBase64, 'audio/ogg')).resolves.toBe(true);
  }, 15_000);

  it('não bloqueia um áudio com som real (tom senoidal, sem trecho de silêncio)', async () => {
    if (!ffmpegAvailable) return;
    await expect(isAudioEffectivelySilent(toneAudioBase64, 'audio/ogg')).resolves.toBe(false);
  }, 15_000);

  it('falha aberto (não bloqueia) com base64 inválido', async () => {
    await expect(isAudioEffectivelySilent('isto-nao-e-base64-de-audio-valido!!', 'audio/ogg')).resolves.toBe(false);
  });

  it('falha aberto (não bloqueia) com string vazia', async () => {
    await expect(isAudioEffectivelySilent('', 'audio/ogg')).resolves.toBe(false);
  });
});
