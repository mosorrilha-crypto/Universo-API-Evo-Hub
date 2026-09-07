/**
 * TASK-XXXX — módulo de storage compatível com S3 (Cloudflare R2), criado
 * pra eliminar o egress do Supabase Storage (mídia de WhatsApp/Base de
 * Conhecimento respondia por ~91% do egress do ciclo de faturamento).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class FakeS3Client {
    send(command: any) {
      return sendMock(command);
    }
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
  };
});

import { getObjectStorageConfig, putObject, getObject, deleteObject } from '../objectStorage';

const CONFIG = { accountId: 'acc123', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'app-data' };

beforeEach(() => {
  sendMock.mockReset();
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_NAME;
});

describe('getObjectStorageConfig', () => {
  it('retorna undefined quando qualquer variável de ambiente estiver ausente', () => {
    expect(getObjectStorageConfig()).toBeUndefined();
    process.env.R2_ACCOUNT_ID = 'acc123';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    expect(getObjectStorageConfig()).toBeUndefined();
  });

  it('retorna a config completa quando as 4 variáveis estão presentes', () => {
    process.env.R2_ACCOUNT_ID = 'acc123';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'app-data';
    expect(getObjectStorageConfig()).toEqual({ accountId: 'acc123', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'app-data' });
  });
});

describe('putObject/getObject/deleteObject', () => {
  it('envia o binário com o Content-Type informado', async () => {
    sendMock.mockResolvedValue({});
    const buffer = Buffer.from('conteúdo real');
    await putObject(CONFIG, 'kb-image/tenant-a/img-1', buffer, 'image/png');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: 'app-data', Key: 'kb-image/tenant-a/img-1', Body: buffer, ContentType: 'image/png' });
  });

  it('retorna o binário e o content-type quando o objeto existe', async () => {
    const bytes = new Uint8Array(Buffer.from('foto real'));
    sendMock.mockResolvedValue({ ContentType: 'image/jpeg', Body: { transformToByteArray: async () => bytes } });

    const result = await getObject(CONFIG, 'kb-image/tenant-a/img-1');

    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('image/jpeg');
    expect(result!.buffer.toString()).toBe('foto real');
  });

  it('retorna null quando o objeto não existe (NoSuchKey)', async () => {
    sendMock.mockRejectedValue({ name: 'NoSuchKey' });
    const result = await getObject(CONFIG, 'kb-image/tenant-a/inexistente');
    expect(result).toBeNull();
  });

  it('propaga qualquer outro erro (ex: credencial inválida) em vez de mascarar como "ausente"', async () => {
    sendMock.mockRejectedValue({ name: 'AccessDenied', message: 'Invalid credentials' });
    await expect(getObject(CONFIG, 'kb-image/tenant-a/img-1')).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('apaga o objeto pela chave informada', async () => {
    sendMock.mockResolvedValue({});
    await deleteObject(CONFIG, 'kb-image/tenant-a/img-1');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({ Bucket: 'app-data', Key: 'kb-image/tenant-a/img-1' });
  });
});
