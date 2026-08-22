import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteSpy = vi.fn();
const upsertSpy = vi.fn();

vi.mock('./db', () => ({
  getDb: () => ({
    from: () => ({
      upsert: upsertSpy,
      delete: () => ({ eq: () => ({ eq: deleteSpy }) }),
    }),
  }),
}));

import { bufferIncomingText } from './messageBuffer';

const tenant = { tenantId: 'tenant-tereza', provider: 'meta' as const, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' };

describe('buffer de continuidade da conversa', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deleteSpy.mockReset().mockResolvedValue({ error: null });
    upsertSpy.mockReset().mockResolvedValue({ error: null });
  });

  it('agrupa complemento enviado sete segundos depois em uma única intenção', async () => {
    const onFlush = vi.fn();
    bufferIncomingText('595986643722', 'Teresa', 'Y ese cuanto año dura', 'm-1', tenant, onFlush);
    await vi.advanceTimersByTimeAsync(7000);
    bufferIncomingText('595986643722', 'Teresa', 'Los tres', 'm-2', tenant, onFlush);
    await vi.advanceTimersByTimeAsync(9999);
    expect(onFlush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0]?.[0]).toBe('Y ese cuanto año dura\nLos tres');
    expect(onFlush.mock.calls[0]?.[3]).toBe(2);
  });

  it('remove a marca persistida antes de iniciar o processamento da resposta', async () => {
    const events: string[] = [];
    deleteSpy.mockImplementation(async () => {
      events.push('delete');
      return { error: null };
    });
    bufferIncomingText('595986643722', 'Teresa', 'Hola precio', 'm-3', tenant, () => events.push('flush'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(['delete', 'flush']);
  });
});
