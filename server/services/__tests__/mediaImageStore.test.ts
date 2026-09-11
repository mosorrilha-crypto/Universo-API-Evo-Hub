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

import { getMediaImage, saveMediaImage } from '../mediaImageStore';

const CONFIG = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'app-data' };

beforeEach(() => {
  getObjectStorageConfigMock.mockReset();
  getObjectMock.mockReset();
  putObjectMock.mockReset();
  getLegacySupabaseStorageObjectMock.mockReset();
});

// Achado real em produção (11/09/2026): sem R2 configurado, saveMediaImage
// só fazia `return` — nenhum log, nenhum jeito de saber depois que a mídia
// nunca foi salva (GET /api/media devolvia 404 genérico, indistinguível de
// mídia que nunca existiu). Trava que a ausência de config agora é sempre
// logada, e que putObject nunca é chamado nesse caso (nada pra salvar).
describe('saveMediaImage', () => {
  it('sem R2 configurado, avisa no log e não chama putObject', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getObjectStorageConfigMock.mockReturnValue(undefined);

    await saveMediaImage('https://proj.supabase.co', 'key', 'wa-123', 'base64data', 'image/jpeg');

    expect(putObjectMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('R2 não configurado'));
    warnSpy.mockRestore();
  });

  it('com R2 configurado, salva via putObject sem logar nada', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    putObjectMock.mockResolvedValue(undefined);

    await saveMediaImage('https://proj.supabase.co', 'key', 'wa-123', 'base64data', 'image/jpeg');

    expect(putObjectMock).toHaveBeenCalledWith(CONFIG, 'media/wa-123', expect.any(Buffer), 'image/jpeg');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('quando putObject falha, avisa no log com a mensagem original', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getObjectStorageConfigMock.mockReturnValue(CONFIG);
    putObjectMock.mockRejectedValue(new Error('AccessDenied'));

    await saveMediaImage('https://proj.supabase.co', 'key', 'wa-123', 'base64data', 'image/jpeg');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Falha ao salvar imagem recebida'), 'AccessDenied');
    warnSpy.mockRestore();
  });
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
