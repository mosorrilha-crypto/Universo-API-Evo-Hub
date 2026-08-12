/**
 * Epic 4.6 follow-up: até aqui, o envio manual do painel (texto, mídia,
 * foto de exemplo) só falava com a Meta Cloud API, mesmo pra tenants
 * conectados via Evolution API (Porta A, QR Code) — resolveCredentialsForTenant
 * já existia em tenantResolver.ts, mas nenhuma rota de conversations.ts
 * chamava de verdade ("Isolando Evolution por enquanto" nos comentários).
 * Esses testes cobrem o roteamento por provedor: um tenant com credencial
 * Evolution cadastrada (tenant_evolution_credentials) deve usar
 * evolutionSend.ts, nunca metaSend.ts, e vice-versa.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const sendWhatsAppTextMessage = vi.fn(async () => undefined);
const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const sendWhatsAppAudioMessage = vi.fn(async () => 'media-id-123');

const sendEvolutionTextMessage = vi.fn(async () => undefined);
const sendEvolutionMediaMessage = vi.fn(async () => undefined);

const saveMediaImage = vi.fn(async (_supabaseUrl?: string, _supabaseKey?: string, _messageId?: string, _base64?: string, _mimeType?: string) => undefined);
const transcodeToWhatsAppVoiceNote = vi.fn(async (_base64: string, _mimeType: string) => ({ base64: 'bXAzLWNvbnZlcnRpZG8=', mimeType: 'audio/mpeg' }));
const getKnowledgeBase = vi.fn(async () => ({
  products: [{ name: 'Microlips', price: 'R$ 500', exampleImageBase64: 'ZmFrZS1pbWFnZQ==', exampleImageMimeType: 'image/jpeg' }],
}));

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage, sendWhatsAppAudioMessage };
});
vi.mock('../../services/evolutionSend', () => ({ sendEvolutionTextMessage, sendEvolutionMediaMessage, showEvolutionTyping: vi.fn() }));
vi.mock('../../services/mediaImageStore', () => ({ getMediaImage: vi.fn(), saveMediaImage }));
vi.mock('../../services/audioTranscode', () => ({ transcodeToWhatsAppVoiceNote }));
vi.mock('../../services/knowledgeBaseStore', () => ({ getKnowledgeBase, setKnowledgeBase: vi.fn() }));

const { createConversationsRouter } = await import('../conversations');

const TENANT_EVOLUTION = 'tenant-evolution';
const TENANT_META = 'tenant-meta';

let server: Server;
let baseUrl: string;
let currentTenantId = TENANT_EVOLUTION;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: currentTenantId, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'shared-tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'shared-pn',
      evolutionApiUrl: 'https://evo.example.com',
      evolutionApiKey: 'shared-evo-key',
      evolutionInstanceName: 'shared-instance',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  sendWhatsAppTextMessage.mockClear();
  uploadWhatsAppMedia.mockClear();
  sendWhatsAppMediaMessage.mockClear();
  sendWhatsAppAudioMessage.mockClear();
  sendEvolutionTextMessage.mockClear();
  sendEvolutionMediaMessage.mockClear();
  saveMediaImage.mockClear();
  transcodeToWhatsAppVoiceNote.mockClear();

  const supabase = createFakeSupabase({
    conversations: [
      { id: 'conv-evo', tenant_id: TENANT_EVOLUTION, phone: '595981111111', name: 'Cliente Evolution', updated_at: new Date().toISOString(), geo_restriction: null },
      { id: 'conv-meta', tenant_id: TENANT_META, phone: '595982222222', name: 'Cliente Meta', updated_at: new Date().toISOString(), geo_restriction: null },
    ],
    tenant_evolution_credentials: [
      { tenant_id: TENANT_EVOLUTION, instance_name: 'instancia-cliente', api_url: 'https://evo-cliente.example.com', api_key: 'tenant-evo-key' },
    ],
  });
  initDb(supabase);
});

describe('Roteamento por provedor (Evolution vs Meta) no envio manual do painel', () => {
  it('POST /send usa evolutionSend pra tenant com credencial Evolution, nunca metaSend', async () => {
    currentTenantId = TENANT_EVOLUTION;
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Oi!' }),
    });
    expect(res.status).toBe(200);
    expect(sendEvolutionTextMessage).toHaveBeenCalledWith('instancia-cliente', 'https://evo-cliente.example.com', 'tenant-evo-key', '595981111111', 'Oi!');
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
  });

  it('POST /send usa metaSend pra tenant sem credencial Evolution (fallback Meta)', async () => {
    currentTenantId = TENANT_META;
    const res = await fetch(`${baseUrl}/api/conversations/595982222222/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Oi!' }),
    });
    expect(res.status).toBe(200);
    expect(sendWhatsAppTextMessage).toHaveBeenCalledWith('shared-pn', 'shared-tok', '595982222222', 'Oi!');
    expect(sendEvolutionTextMessage).not.toHaveBeenCalled();
  });

  it('POST /send-media (imagem) usa evolutionSend.sendEvolutionMediaMessage pra tenant Evolution', async () => {
    currentTenantId = TENANT_EVOLUTION;
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'aW1hZ2VtLWZha2U=', mimeType: 'image/jpeg', filename: 'foto.jpg', caption: 'Legenda' }),
    });
    expect(res.status).toBe(200);
    expect(sendEvolutionMediaMessage).toHaveBeenCalledWith(
      'instancia-cliente', 'https://evo-cliente.example.com', 'tenant-evo-key',
      '595981111111', 'aW1hZ2VtLWZha2U=', 'image/jpeg', 'foto.jpg', 'Legenda'
    );
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(sendWhatsAppMediaMessage).not.toHaveBeenCalled();
  });

  it('POST /send-media (áudio) transcodifica e usa evolutionSend, nunca sendWhatsAppAudioMessage', async () => {
    currentTenantId = TENANT_EVOLUTION;
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'd2VibS1mYWtl', mimeType: 'audio/webm;codecs=opus', filename: 'audio.webm' }),
    });
    expect(res.status).toBe(200);
    expect(transcodeToWhatsAppVoiceNote).toHaveBeenCalledWith('d2VibS1mYWtl', 'audio/webm;codecs=opus');
    expect(sendEvolutionMediaMessage).toHaveBeenCalledWith(
      'instancia-cliente', 'https://evo-cliente.example.com', 'tenant-evo-key',
      '595981111111', 'bXAzLWNvbnZlcnRpZG8=', 'audio/mpeg', 'audio.mp3'
    );
    expect(sendWhatsAppAudioMessage).not.toHaveBeenCalled();

    expect(saveMediaImage).toHaveBeenCalledTimes(1);
    const [, , , savedBase64, savedMimeType] = saveMediaImage.mock.calls[0];
    expect(savedBase64).toBe('bXAzLWNvbnZlcnRpZG8=');
    expect(savedMimeType).toBe('audio/mpeg');
  });

  it('POST /send-example-photo usa evolutionSend pra tenant Evolution', async () => {
    currentTenantId = TENANT_EVOLUTION;
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-example-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: 'Microlips' }),
    });
    expect(res.status).toBe(200);
    expect(sendEvolutionMediaMessage).toHaveBeenCalledWith(
      'instancia-cliente', 'https://evo-cliente.example.com', 'tenant-evo-key',
      '595981111111', 'ZmFrZS1pbWFnZQ==', 'image/jpeg', 'Microlips.jpg', 'Microlips'
    );
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });
});
