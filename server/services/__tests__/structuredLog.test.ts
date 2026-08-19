import { describe, expect, it, vi } from 'vitest';
import { logStructured, withStructuredLog } from '../structuredLog';

describe('logStructured', () => {
  it('loga sucesso em console.log com todos os campos, na ordem esperada', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ tenantId: 'tenant-a', area: 'googleCalendar', op: 'listUpcomingEvents', outcome: 'success', latencyMs: 123 });
    expect(spy).toHaveBeenCalledWith('[LOG] tenant=tenant-a area=googleCalendar op=listUpcomingEvents outcome=success latency_ms=123');
    spy.mockRestore();
  });

  it('loga erro em console.warn, incluindo detail sem aspas duplas cruas', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logStructured({ tenantId: 'tenant-a', area: 'googleCalendar', op: 'listUpcomingEvents', outcome: 'error', latencyMs: 45, detail: 'invalid_grant: token "expirado"' });
    expect(spy).toHaveBeenCalledWith(
      `[LOG] tenant=tenant-a area=googleCalendar op=listUpcomingEvents outcome=error latency_ms=45 detail="invalid_grant: token 'expirado'"`
    );
    spy.mockRestore();
  });

  it('omite campos opcionais ausentes em vez de imprimir undefined', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ tenantId: 'tenant-a', area: 'appointmentStore', op: 'confirmPayment', outcome: 'success' });
    expect(spy).toHaveBeenCalledWith('[LOG] tenant=tenant-a area=appointmentStore op=confirmPayment outcome=success');
    spy.mockRestore();
  });
});

describe('withStructuredLog', () => {
  it('loga sucesso e devolve o resultado da função quando ela resolve', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await withStructuredLog({ tenantId: 'tenant-a', area: 'appointmentStore', op: 'confirmPayment' }, async () => 'ok');
    expect(result).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/^\[LOG\] tenant=tenant-a area=appointmentStore op=confirmPayment outcome=success latency_ms=\d+$/);
    spy.mockRestore();
  });

  it('loga erro com a mensagem da exceção e relança, sem engolir a falha', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      withStructuredLog({ tenantId: 'tenant-a', area: 'googleCalendar', op: 'listUpcomingEvents' }, async () => {
        throw new Error('invalid_grant');
      })
    ).rejects.toThrow('invalid_grant');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(
      /^\[LOG\] tenant=tenant-a area=googleCalendar op=listUpcomingEvents outcome=error latency_ms=\d+ detail="invalid_grant"$/
    );
    spy.mockRestore();
  });
});
