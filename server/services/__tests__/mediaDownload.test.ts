/**
 * TASK-0398 (achado real: imagem de lead com "Imagem indisponível (HTTP
 * 404)" no painel, mesmo com a mensagem tendo chegado normalmente) —
 * `withMediaDownloadRetry` tenta de novo (poucas vezes, backoff curto)
 * antes de desistir, mesmo padrão de `withGeminiRetry` (server/gemini.ts).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withMediaDownloadRetry } from '../mediaDownload';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushRetries<T>(promise: Promise<T>): Promise<T> {
  // Cada tentativa aguarda um setTimeout real (backoff) — avança o relógio
  // fake em passos, dando chance de cada microtask/retry rodar entre eles.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
  }
  return promise;
}

describe('withMediaDownloadRetry', () => {
  it('devolve o resultado direto quando a primeira tentativa já funciona, sem nenhum backoff', async () => {
    const download = vi.fn().mockResolvedValue({ base64: 'abc', mimeType: 'image/jpeg' });
    const result = await withMediaDownloadRetry(download);
    expect(result).toEqual({ base64: 'abc', mimeType: 'image/jpeg' });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo depois de uma falha transitória (ex.: mídia ainda não disponível) e devolve sucesso na segunda tentativa', async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error('Falha ao baixar mídia da Evolution API: HTTP 404'))
      .mockResolvedValueOnce({ base64: 'xyz', mimeType: 'image/png' });

    const promise = withMediaDownloadRetry(download);
    const result = await flushRetries(promise);
    expect(result).toEqual({ base64: 'xyz', mimeType: 'image/png' });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('desiste depois de esgotar todas as tentativas e propaga o último erro', async () => {
    const download = vi.fn().mockRejectedValue(new Error('HTTP 404'));

    const promise = withMediaDownloadRetry(download);
    promise.catch(() => {});
    await flushRetries(promise).catch(() => {});

    await expect(promise).rejects.toThrow('HTTP 404');
    // 1 tentativa inicial + 2 backoffs configurados = 3 chamadas no total.
    expect(download).toHaveBeenCalledTimes(3);
  });
});
