/**
 * Achado real (27/08/2026): áudio ENVIADO pelo operador pelo painel nunca
 * era transcrito — só o placeholder fixo "🎤 Áudio enviado" ficava salvo
 * pra sempre em `messages.text`, diferente do áudio recebido do cliente
 * (webhooks.ts + transcriptionQueue.ts, que sobrescreve via
 * updateMessageText assim que o Gemini responde). Como `autoReply.ts`
 * monta o histórico do agente a partir de `message.text`
 * (`buildHistoryText`), uma instrução dada por voz pelo operador nunca
 * chegava ao contexto do agente. POST /send-media agora chama o mesmo
 * `transcribeAudioWithGemini` já usado pelo lado de entrada e pelo
 * endpoint `/retry-transcription`, de forma aguardada, sem derrubar a
 * resposta de sucesso se a transcrição falhar (o áudio real já foi
 * entregue ao cliente nesse ponto).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const sendWhatsAppAudioMessage = vi.fn(async () => 'media-id-123');
const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const saveMediaImage = vi.fn(async () => undefined);
const transcodeToWhatsAppVoiceNote = vi.fn(async (_base64: string, _mimeType: string, output: 'ogg_opus' | 'mp3') => (
  output === 'ogg_opus'
    ? { base64: 'b2dnLW9wdXMtY29udmVydGlkbw==', mimeType: 'audio/ogg; codecs=opus' }
    : { base64: 'bXAzLWNvbnZlcnRpZG8=', mimeType: 'audio/mpeg' }
));
const transcribeAudioWithGemini = vi.fn();

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, sendWhatsAppAudioMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage };
});
vi.mock('../../services/mediaImageStore', () => ({ getMediaImage: vi.fn(), saveMediaImage }));
vi.mock('../../services/audioTranscode', () => ({ transcodeToWhatsAppVoiceNote }));
vi.mock('../../services/geminiTranscription', () => ({ transcribeAudioWithGemini }));

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
      getAi: () => null,
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  sendWhatsAppAudioMessage.mockClear();
  saveMediaImage.mockClear();
  transcodeToWhatsAppVoiceNote.mockClear();
  transcribeAudioWithGemini.mockReset();
  supabase = createFakeSupabase({
    conversations: [{ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: new Date().toISOString(), geo_restriction: null }],
  });
  initDb(supabase);
});

async function sendAudio() {
  return fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: 'd2VibS1mYWtl', mimeType: 'audio/webm;codecs=opus', filename: 'audio.webm' }),
  });
}

describe('POST /api/conversations/:phone/send-media — transcreve áudio enviado pelo operador', () => {
  it('grava a transcrição real no lugar do placeholder quando o Gemini responde com sucesso', async () => {
    transcribeAudioWithGemini.mockResolvedValue({ source: 'gemini', result: { transcription: 'Oi, seu horário ficou confirmado pra amanhã às 15h.' } });

    const res = await sendAudio();
    expect(res.status).toBe(200);

    expect(transcribeAudioWithGemini).toHaveBeenCalledWith(
      null,
      'b2dnLW9wdXMtY29udmVydGlkbw==',
      'audio/ogg; codecs=opus',
      expect.objectContaining({ leadName: 'Cliente A' })
    );

    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'audio');
    expect(savedMessage).toBeTruthy();
    expect(savedMessage.text).toBe('Oi, seu horário ficou confirmado pra amanhã às 15h.');
    expect(savedMessage.text).not.toBe('🎤 Áudio enviado');
  });

  it('achado real (29/08/2026): grava um texto legível, nunca a string vazia, quando não há fala real detectada (source "gemini" com transcription "")', async () => {
    transcribeAudioWithGemini.mockResolvedValue({ source: 'gemini', result: { transcription: '' } });

    const res = await sendAudio();
    expect(res.status).toBe(200);

    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'audio');
    expect(savedMessage.text).toBe('[Áudio sem fala detectável]');
    expect(savedMessage.text).not.toBe('');
  });

  it('grava o mesmo texto de fallback do lado de entrada quando o Gemini falha/está indisponível', async () => {
    transcribeAudioWithGemini.mockResolvedValue({ source: 'fallback', result: { transcription: '[Não foi possível transcrever o áudio no momento]' } });

    const res = await sendAudio();
    expect(res.status).toBe(200);

    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'audio');
    expect(savedMessage.text).toBe('[Não foi possível transcrever o áudio no momento]');
  });

  it('o envio continua respondendo 200 mesmo se a chamada de transcrição lançar uma exceção', async () => {
    transcribeAudioWithGemini.mockRejectedValue(new Error('Gemini timeout'));

    const res = await sendAudio();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    // Áudio real já foi enviado à cliente independente da falha de transcrição.
    expect(sendWhatsAppAudioMessage).toHaveBeenCalledTimes(1);
    // Sem sobrescrita bem-sucedida, o placeholder original permanece.
    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'audio');
    expect(savedMessage.text).toBe('🎤 Áudio enviado');
  });

  it('NÃO chama transcrição pra mídia que não é áudio (imagem)', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'aW1hZ2VtLWZha2U=', mimeType: 'image/jpeg', filename: 'foto.jpg' }),
    });
    expect(res.status).toBe(200);
    expect(transcribeAudioWithGemini).not.toHaveBeenCalled();
  });
});
