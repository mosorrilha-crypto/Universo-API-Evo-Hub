import { spawn } from 'child_process';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
// @ts-ignore — ffmpeg-static publica o caminho do binário sem declarações de tipo.
import ffmpegPath from 'ffmpeg-static';

const MIME_OGG_OPUS = 'audio/ogg; codecs=opus';
const MAX_NATIVE_VOICE_BYTES = 512 * 1024;

type ProbeResponse = {
  label: string;
  status: number;
  statusText: string;
  body: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}. O ensaio foi interrompido antes de qualquer chamada externa.`);
  }
  return value;
}

function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
}

async function generateOggOpusMono(outputPath: string): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static não está disponível; não foi possível gerar o OGG/Opus de teste.');
  }

  await new Promise<void>((resolve, reject) => {
    const process = spawn(ffmpegPath as unknown as string, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=660:sample_rate=16000:duration=1',
      '-ac', '1',
      '-c:a', 'libopus',
      '-b:a', '24k',
      '-vbr', 'on',
      '-application', 'voip',
      '-f', 'ogg',
      outputPath,
    ]);
    let stderr = '';
    process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg falhou ao gerar OGG/Opus mono (código ${code}): ${stderr.slice(-800)}`));
    });
  });

  const audio = await fs.readFile(outputPath);
  const hasOggSignature = audio.subarray(0, 4).toString('ascii') === 'OggS';
  const hasOpusHeader = audio.includes(Buffer.from('OpusHead'));
  if (!hasOggSignature || !hasOpusHeader) {
    throw new Error('O arquivo gerado não contém as assinaturas OggS e OpusHead esperadas.');
  }
  if (audio.length > MAX_NATIVE_VOICE_BYTES) {
    throw new Error(`O arquivo de teste tem ${audio.length} bytes, acima do limite de ${MAX_NATIVE_VOICE_BYTES} bytes para ícone de reprodução nativo.`);
  }
  return audio;
}

async function requestAndRecord(
  responses: ProbeResponse[],
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ body: string; ok: boolean }> {
  const response = await fetch(url, init);
  const body = await response.text();
  responses.push({ label, status: response.status, statusText: response.statusText, body });
  return { body, ok: response.ok };
}

async function main(): Promise<void> {
  const accessToken = requiredEnv('META_ACCESS_TOKEN');
  const phoneNumberId = requiredEnv('META_PHONE_NUMBER_ID');
  const recipient = requiredEnv('WHATSAPP_TEST_TO');
  const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v23.0';
  const outputLog = path.resolve(
    process.env.META_PROBE_LOG?.trim()
      || `artifacts/meta-ogg-opus-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const tmpAudioPath = path.join(os.tmpdir(), `meta-ogg-opus-probe-${crypto.randomUUID()}.ogg`);
  const responses: ProbeResponse[] = [];

  try {
    const audio = await generateOggOpusMono(tmpAudioPath);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    // A Meta documenta que audio/ogg sem o codec não é suportado para OGG/Opus.
    form.append('type', MIME_OGG_OPUS);
    form.append('file', new Blob([audio], { type: MIME_OGG_OPUS }), 'meta-voice-probe.ogg');

    const mediaUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`;
    const upload = await requestAndRecord(responses, 'upload', mediaUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!upload.ok) throw new Error('A Meta recusou o upload OGG/Opus; consulte o registro bruto.');

    const uploadPayload = JSON.parse(upload.body) as { id?: string };
    if (!uploadPayload.id) throw new Error('A resposta de upload da Meta não retornou media_id; consulte o registro bruto.');

    const mediaInfo = await requestAndRecord(
      responses,
      'media_inspection',
      `https://graph.facebook.com/${apiVersion}/${uploadPayload.id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!mediaInfo.ok) throw new Error('A Meta recusou a consulta do media_id; consulte o registro bruto.');

    const message = await requestAndRecord(
      responses,
      'send_voice_message',
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'audio',
          audio: { id: uploadPayload.id, voice: true },
        }),
      },
    );
    if (!message.ok) throw new Error('A Meta recusou o envio da nota de voz; consulte o registro bruto.');

    const report = {
      generatedAt: new Date().toISOString(),
      apiVersion,
      recipient: redactPhone(recipient),
      localArtifact: {
        mimeType: MIME_OGG_OPUS,
        bytes: audio.length,
        oggSignature: audio.subarray(0, 4).toString('ascii'),
        opusHeaderFound: audio.includes(Buffer.from('OpusHead')),
      },
      responses,
    };
    await fs.mkdir(path.dirname(outputLog), { recursive: true });
    await fs.writeFile(outputLog, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(outputLog, 0o600);
    console.log(`Ensaio concluído para ${redactPhone(recipient)}. Respostas brutas registradas em ${outputLog}.`);
  } catch (error) {
    const report = {
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      responses,
    };
    await fs.mkdir(path.dirname(outputLog), { recursive: true });
    await fs.writeFile(outputLog, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(outputLog, 0o600);
    throw error;
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
