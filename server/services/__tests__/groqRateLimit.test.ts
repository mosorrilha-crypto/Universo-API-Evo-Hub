import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGroqJsonCompletion } from '../groqClient';
import { assertGroqAvailable, rememberGroqRateLimit, resetGroqRateLimitsForTests } from '../groqRateLimit';
afterEach(() => { resetGroqRateLimitsForTests(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Cota Groq', () => {
  it('pula rede durante Retry-After e volta a tentar após expirar', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'retry-after': '120' } }))
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"agent":"faq"}' } }] })));
    vi.stubGlobal('fetch', fetch);
    await expect(callGroqJsonCompletion('key-a', 'oi')).rejects.toThrow('429');
    await expect(callGroqJsonCompletion('key-a', 'oi')).rejects.toThrow('em pausa');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120001);
    expect((await callGroqJsonCompletion('key-a', 'oi')).parsed.agent).toBe('faq');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('respeita duração retornada no erro e isola chave e modelo', () => {
    vi.useFakeTimers();
    rememberGroqRateLimit('key-a', 'model-a', new Response('', { status: 429 }), 'Please try again in 20m53.232s.');
    expect(() => assertGroqAvailable('key-a', 'model-a')).toThrow('em pausa');
    expect(() => assertGroqAvailable('key-b', 'model-a')).not.toThrow();
    expect(() => assertGroqAvailable('key-a', 'model-b')).not.toThrow();
    vi.advanceTimersByTime(1253233);
    expect(() => assertGroqAvailable('key-a', 'model-a')).not.toThrow();
  });
  it('usa fallback limitado sem prazo válido e não bloqueia outros erros', () => {
    vi.useFakeTimers();
    rememberGroqRateLimit('k', 'm', new Response('', { status: 503 }), 'fail');
    expect(() => assertGroqAvailable('k', 'm')).not.toThrow();
    rememberGroqRateLimit('k', 'm', new Response('', { status: 429, headers: { 'retry-after': 'invalid' } }), 'fail');
    expect(() => assertGroqAvailable('k', 'm')).toThrow();
    vi.advanceTimersByTime(60001);
    expect(() => assertGroqAvailable('k', 'm')).not.toThrow();
  });
});
