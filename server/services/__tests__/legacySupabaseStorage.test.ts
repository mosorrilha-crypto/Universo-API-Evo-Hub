/**
 * TASK-0332 (achado real, pós-merge): fallback de leitura pro Supabase
 * Storage legado, usado quando o objeto não existe (ainda) no Cloudflare R2
 * — cobre mídia de conversa (comprovantes/fotos de clientes) enviada antes
 * da migração, que não dá pra "reenviar".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLegacySupabaseStorageObject } from '../legacySupabaseStorage';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('getLegacySupabaseStorageObject', () => {
  it('retorna null quando supabaseUrl/supabaseKey estão ausentes', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    expect(await getLegacySupabaseStorageObject(undefined, undefined, 'media/msg-1')).toBeNull();
    expect(await getLegacySupabaseStorageObject('https://x.supabase.co', undefined, 'media/msg-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna null quando supabaseUrl é inválida ou não http(s)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    expect(await getLegacySupabaseStorageObject('não-é-url', 'key', 'media/msg-1')).toBeNull();
    expect(await getLegacySupabaseStorageObject('ftp://x.supabase.co', 'key', 'media/msg-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca o objeto no bucket app-data com os headers de autenticação corretos', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('foto antiga').buffer,
      headers: { get: () => 'image/jpeg' },
    }));
    global.fetch = fetchMock as any;

    const result = await getLegacySupabaseStorageObject('https://proj.supabase.co', 'service-key', 'kb-image/tenant-a/img-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proj.supabase.co/storage/v1/object/app-data/kb-image/tenant-a/img-1',
      { headers: { apikey: 'service-key', Authorization: 'Bearer service-key' } }
    );
    expect(result).toEqual({ buffer: Buffer.from('foto antiga'), contentType: 'image/jpeg' });
  });

  it('retorna null quando o objeto não existe (HTTP não-ok)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as any;
    expect(await getLegacySupabaseStorageObject('https://proj.supabase.co', 'key', 'media/inexistente')).toBeNull();
  });

  it('nunca lança em erro de rede — retorna null (melhor esforço)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('rede fora');
    }) as any;
    await expect(getLegacySupabaseStorageObject('https://proj.supabase.co', 'key', 'media/msg-1')).resolves.toBeNull();
  });
});
