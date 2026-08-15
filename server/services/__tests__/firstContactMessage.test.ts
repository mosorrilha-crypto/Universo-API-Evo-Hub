import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentKnowledgeBase, FirstContactBlock } from '../knowledgeBaseStore';
import type { MediaSendConfig } from '../autoReply';

const sendWhatsAppTextMessage = vi.fn(async () => undefined);
const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const sendEvolutionTextMessage = vi.fn(async () => undefined);
const sendEvolutionMediaMessage = vi.fn(async () => undefined);
const recordOutgoingMessage = vi.fn(async (..._args: any[]) => ({}) as any);
const getKnowledgeBaseVideo = vi.fn(async () => ({ buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' }));
const getKnowledgeBaseDocument = vi.fn(async () => ({ buffer: Buffer.from('fake-pdf-bytes'), contentType: 'application/pdf' }));

vi.mock('../metaSend', () => ({ sendWhatsAppTextMessage, uploadWhatsAppMedia, sendWhatsAppMediaMessage }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage, sendEvolutionMediaMessage }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage }));
vi.mock('../knowledgeBaseVideoStore', () => ({ getKnowledgeBaseVideo }));
vi.mock('../knowledgeBaseDocumentStore', () => ({ getKnowledgeBaseDocument }));

const { hasFirstContactMessage, sendFirstContactMessage } = await import('../firstContactMessage');

const TENANT_ID = 'tenant-clic-piscinas';
const PHONE = '595981111111';
const META_CONFIG: MediaSendConfig = { provider: 'meta', phoneNumberId: 'pnid-1', accessToken: 'token-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' };
const EVOLUTION_CONFIG: MediaSendConfig = { provider: 'evolution', evolutionInstanceName: 'inst-1', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'evo-key', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' };

const textBlock = (text: string, id = 'b-text'): FirstContactBlock => ({ id, type: 'text', text });
const imageBlock = (id = 'b-image'): FirstContactBlock => ({ id, type: 'image', imageBase64: 'data:image/jpeg;base64,QQ==', imageMimeType: 'image/jpeg' });
const videoBlock = (id = 'b-video'): FirstContactBlock => ({ id, type: 'video', videoId: 'video-1', videoMimeType: 'video/mp4', videoFileName: 'piscinas.mp4' });
const fileBlock = (id = 'b-file'): FirstContactBlock => ({ id, type: 'file', fileId: 'file-1', fileMimeType: 'application/pdf', fileName: 'catalogo.pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  getKnowledgeBaseVideo.mockResolvedValue({ buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' });
  getKnowledgeBaseDocument.mockResolvedValue({ buffer: Buffer.from('fake-pdf-bytes'), contentType: 'application/pdf' });
});

describe('hasFirstContactMessage', () => {
  it('false quando a base não tem firstContactBlocks nenhum', () => {
    expect(hasFirstContactMessage(null)).toBe(false);
    expect(hasFirstContactMessage({} as AgentKnowledgeBase)).toBe(false);
    expect(hasFirstContactMessage({ firstContactBlocks: [] } as AgentKnowledgeBase)).toBe(false);
  });

  it('false quando todo bloco existente está vazio pro seu próprio tipo', () => {
    const kb: AgentKnowledgeBase = { firstContactBlocks: [{ id: '1', type: 'text', text: '   ' }, { id: '2', type: 'image' }] };
    expect(hasFirstContactMessage(kb)).toBe(false);
  });

  it('true quando pelo menos um bloco tem conteúdo', () => {
    expect(hasFirstContactMessage({ firstContactBlocks: [textBlock('Oi!')] } as AgentKnowledgeBase)).toBe(true);
    expect(hasFirstContactMessage({ firstContactBlocks: [imageBlock()] } as AgentKnowledgeBase)).toBe(true);
    expect(hasFirstContactMessage({ firstContactBlocks: [videoBlock()] } as AgentKnowledgeBase)).toBe(true);
    expect(hasFirstContactMessage({ firstContactBlocks: [fileBlock()] } as AgentKnowledgeBase)).toBe(true);
  });
});

describe('sendFirstContactMessage', () => {
  it('manda os blocos na ordem exata do array: texto > vídeo > texto', async () => {
    const kb: AgentKnowledgeBase = {
      firstContactBlocks: [
        textBlock('Bem-vindo à Clic Piscinas!', 'b1'),
        videoBlock('b2'),
        textBlock('Qualquer dúvida, é só chamar.', 'b3'),
      ],
    };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(sendWhatsAppTextMessage).toHaveBeenCalledTimes(2);
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(1); // 1 vídeo
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(3);

    const order = [
      sendWhatsAppTextMessage.mock.invocationCallOrder[0], // bloco 1 (texto)
      uploadWhatsAppMedia.mock.invocationCallOrder[0], // bloco 2 (vídeo)
      sendWhatsAppTextMessage.mock.invocationCallOrder[1], // bloco 3 (texto)
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(sendWhatsAppTextMessage).toHaveBeenNthCalledWith(1, 'pnid-1', 'token-1', PHONE, 'Bem-vindo à Clic Piscinas!');
    expect(sendWhatsAppTextMessage).toHaveBeenNthCalledWith(2, 'pnid-1', 'token-1', PHONE, 'Qualquer dúvida, é só chamar.');
  });

  it('manda um bloco de arquivo (ex: catálogo em PDF) via Meta', async () => {
    const kb: AgentKnowledgeBase = { firstContactBlocks: [fileBlock()] };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(getKnowledgeBaseDocument).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_ID, 'file-1');
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pnid-1', 'token-1', Buffer.from('fake-pdf-bytes'), 'application/pdf', 'catalogo.pdf');
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage.mock.calls[0][2]).toMatchObject({ type: 'file' });
  });

  it('pula blocos sem conteúdo, mas manda os demais', async () => {
    const kb: AgentKnowledgeBase = {
      firstContactBlocks: [{ id: '1', type: 'text', text: '' }, imageBlock('2')],
    };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(1);
  });

  it('usa as funções de envio da Evolution quando o provider é evolution', async () => {
    const kb: AgentKnowledgeBase = { firstContactBlocks: [textBlock('Oi!')] };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, EVOLUTION_CONFIG);

    expect(sendEvolutionTextMessage).toHaveBeenCalledWith('inst-1', 'https://evo.example.com', 'evo-key', PHONE, 'Oi!');
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
  });

  it('não quebra e não grava nada quando o vídeo configurado não é encontrado no Storage — mas continua pros próximos blocos', async () => {
    getKnowledgeBaseVideo.mockResolvedValueOnce(null);
    const kb: AgentKnowledgeBase = { firstContactBlocks: [videoBlock('1'), textBlock('Depois do vídeo que sumiu', '2')] };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMessage).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage).toHaveBeenCalledTimes(1);
  });

  it('não quebra e não grava nada quando o arquivo configurado não é encontrado no Storage', async () => {
    getKnowledgeBaseDocument.mockResolvedValueOnce(null);
    const kb: AgentKnowledgeBase = { firstContactBlocks: [fileBlock()] };

    await sendFirstContactMessage(TENANT_ID, PHONE, kb, META_CONFIG);

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(recordOutgoingMessage).not.toHaveBeenCalled();
  });

  it('não faz nada quando firstContactBlocks está ausente/vazio', async () => {
    await sendFirstContactMessage(TENANT_ID, PHONE, {}, META_CONFIG);
    await sendFirstContactMessage(TENANT_ID, PHONE, { firstContactBlocks: [] }, META_CONFIG);

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(recordOutgoingMessage).not.toHaveBeenCalled();
  });
});
