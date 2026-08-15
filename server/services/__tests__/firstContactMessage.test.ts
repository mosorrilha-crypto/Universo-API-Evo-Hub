import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentKnowledgeBase } from '../knowledgeBaseStore';
import type { MediaSendConfig } from '../autoReply';

const sendWhatsAppTextMessage = vi.fn(async () => undefined);
const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const sendEvolutionTextMessage = vi.fn(async () => undefined);
const sendEvolutionMediaMessage = vi.fn(async () => undefined);
const recordOutgoingMessage = vi.fn(async (..._args: any[]) => ({}) as any);
const getKnowledgeBaseVideo = vi.fn(async () => ({ buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' }));

vi.mock('../metaSend', () => ({ sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage, sendEvolutionMediaMessage }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage }));
vi.mock('../knowledgeBaseVideoStore', () => ({ getKnowledgeBaseVideo }));

const { hasFirstContactMessage, sendFirstContactMessage } = await import('../firstContactMessage');

const TENANT_ID = 'tenant-clic-piscinas';
const PHONE = '595981111111';
const META_CONFIG: MediaSendConfig = { provider: 'meta', phoneNumberId: 'pnid-1', accessToken: 'token-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' };
const EVOLUTION_CONFIG: MediaSendConfig = { provider: 'evolution', evolutionInstanceName: 'inst-1', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'evo-key', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' };

beforeEach(() => {
  vi.clearAllMocks();
  getKnowledgeBaseVideo.mockResolvedValue({ buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' });
});

describe('hasFirstContactMessage', () => {
  it('false quando a base não tem firstContactMessage nenhum', () => {
    expect(hasFirstContactMessage(null)).toBe(false);
    expect(hasFirstContactMessage({} as AgentKnowledgeBase)).toBe(false);
  });

  it('false quando firstContactMessage existe mas está totalmente vazio', () => {
    expect(hasFirstContactMessage({ firstContactMessage: {} } as AgentKnowledgeBase)).toBe(false);
    expect(hasFirstContactMessage({ firstContactMessage: { text: '   ' } } as AgentKnowledgeBase)).toBe(false);
  });

  it('true quando pelo menos um dos três campos está preenchido', () => {
    expect(hasFirstContactMessage({ firstContactMessage: { text: 'Oi!' } } as AgentKnowledgeBase)).toBe(true);
    expect(hasFirstContactMessage({ firstContactMessage: { imageBase64: 'data:image/jpeg;base64,QQ==' } } as AgentKnowledgeBase)).toBe(true);
    expect(hasFirstContactMessage({ firstContactMessage: { videoId: 'video-1' } } as AgentKnowledgeBase)).toBe(true);
  });
});

describe('sendFirstContactMessage', () => {
  it('manda texto, imagem e vídeo (nessa ordem) via Meta quando os três estão configurados', async () => {
    const kb: AgentKnowledgeBase = {
      firstContactMessage: {
        text: 'Bem-vindo à Clic Piscinas!',
        imageBase64: 'data:image/jpeg;base64,QQ==',
        imageMimeType: 'image/jpeg',
        videoId: 'video-boas-vindas',
        videoMimeType: 'video/mp4',
        videoFileName: 'piscinas.mp4',
      },
    };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(sendWhatsAppTextMessage).toHaveBeenCalledWith('pnid-1', 'token-1', PHONE, 'Bem-vindo à Clic Piscinas!');
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(2); // 1 imagem + 1 vídeo
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledTimes(2);
    expect(getKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_ID, 'video-boas-vindas');
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(3);
    expect(recordOutgoingMessage.mock.calls[0][3]).toBe('ai');
    expect(recordOutgoingMessage.mock.calls[1][3]).toBe('ai');
    expect(recordOutgoingMessage.mock.calls[2][3]).toBe('ai');

    const orderOfCalls = [
      sendWhatsAppTextMessage.mock.invocationCallOrder[0],
      uploadWhatsAppMedia.mock.invocationCallOrder[0],
      uploadWhatsAppMedia.mock.invocationCallOrder[1],
    ];
    expect(orderOfCalls).toEqual([...orderOfCalls].sort((a, b) => a - b));
  });

  it('só manda o que estiver configurado — sem texto, sem imagem, só vídeo', async () => {
    const kb: AgentKnowledgeBase = { firstContactMessage: { videoId: 'video-1' } };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage.mock.calls[0][2]).toMatchObject({ type: 'file' });
  });

  it('usa as funções de envio da Evolution quando o provider é evolution', async () => {
    const kb: AgentKnowledgeBase = { firstContactMessage: { text: 'Oi!' } };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, EVOLUTION_CONFIG);

    expect(sendEvolutionTextMessage).toHaveBeenCalledWith('inst-1', 'https://evo.example.com', 'evo-key', PHONE, 'Oi!');
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
  });

  it('não quebra e não grava nada quando o vídeo configurado não é encontrado no Storage', async () => {
    getKnowledgeBaseVideo.mockResolvedValueOnce(null);
    const kb: AgentKnowledgeBase = { firstContactMessage: { videoId: 'video-sumiu' } };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(recordOutgoingMessage).not.toHaveBeenCalled();
  });

  it('não faz nada quando firstContactMessage está ausente', async () => {
    await sendFirstContactMessage(TENANT_ID, PHONE, {}, META_CONFIG);

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(recordOutgoingMessage).not.toHaveBeenCalled();
  });
});
