/**
 * TASK-0332 (achado real, pós-merge): getMediaImage precisa continuar
 * encontrando mídia de conversa (comprovantes/fotos de clientes) enviada
 * ANTES da migração pro Cloudflare R2 — esse conteúdo só existe no bucket
 * legado do Supabase Storage e não dá pra "reenviar" (já aconteceu).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getObjectStorageConfigMock = vi.fn();
const getObjectMock = vi.fn();
const putObjectMock = vi.fn();

vi.mock('../objectStorage', () => ({
  getObjectStorageConfig: () => getObjectStorageConfigMock(),
  getObject: (...args: any[]) => getObjectMock(...args),
  putObject: (...args: any[]) => putObjectMock(...args),
}));

const getLegacySupabaseStorageObjectMock = vi.fn();
vi.mock('../legacySupabaseStorage', () => ({
  getLegacySupabaseStorageObject: (...args: any[]) => getLegacySupabaseStorageObjectMock(...args),
}));

import { getMediaImage } from '../mediaImageStore';

const CONFIG = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'app-data' };

beforeEach(() => {
  getObjectStorageConfigMock.mockReset();
  getObjectMock.mockReset();
  getLegacySupabaseStorageObjectMock.mockReset();
});

describe('getMediaImage', () => {
  it('retorna do R2 quando encontrado, sem consultar o Supabase Storage legado', async () => {
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    getObjectMock.mockResolvedValue({ buffer: Buffer.from('foto nova'), contentType: 'image/png' });

    const result = await getMediaImage('https://proj.supabase.co', 'key', 'wa-123');

    expect(result).toEqual({ buffer: Buffer.from('foto nova'), contentType: 'image/png' });
    expect(getLegacySupabaseStorageObjectMock).not.toHaveBeenCalled();
  });

  it('cai pro Supabase Storage legado quando o R2 não tem o objeto (mídia pré-migração)', async () => {
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    getObjectMock.mockResolvedValue(null);
    getLegacySupabaseStorageObjectMock.mockResolvedValue({ buffer: Buffer.from('comprovante antigo'), contentType: 'image/jpeg' });

    const result = await getMediaImage('https://proj.supabase.co', 'service-key', 'wa-456');

    expect(getLegacySupabaseStorageObjectMock).toHaveBeenCalledWith('https://proj.supabase.co', 'service-key', 'media/wa-456');
    expect(result).toEqual({ buffer: Buffer.from('comprovante antigo'), contentType: 'image/jpeg' });
  });

  it('cai direto pro legado quando o R2 não está configurado', async () => {
    getObjectStorageConfigMock.mockReturnValue(undefined);
    getLegacySupabaseStorageObjectMock.mockResolvedValue({ buffer: Buffer.from('audio antigo'), contentType: 'audio/ogg' });

    const result = await getMediaImage('https://proj.supabase.co', 'key', 'wa-789');

    expect(getObjectMock).not.toHaveBeenCalled();
    expect(result).toEqual({ buffer: Buffer.from('audio antigo'), contentType: 'audio/ogg' });
  });

  it('retorna null quando não encontra nem no R2 nem no legado', async () => {
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    getObjectMock.mockResolvedValue(null);
    getLegacySupabaseStorageObjectMock.mockResolvedValue(null);

    const result = await getMediaImage('https://proj.supabase.co', 'key', 'wa-000');

    expect(result).toBeNull();
  });

  it('usa audio/ogg como content-type padrão para message_id de áudio (wa-) sem content-type explícito', async () => {
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    getObjectMock.mockResolvedValue(null);
    getLegacySupabaseStorageObjectMock.mockResolvedValue({ buffer: Buffer.from('audio'), contentType: '' });

    const result = await getMediaImage(undefined, undefined, 'wa-999');

    expect(result?.contentType).toBe('audio/ogg; codecs=opus');
  });
});
