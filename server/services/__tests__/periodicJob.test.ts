import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPeriodicJobsForTests, startPeriodicJob } from '../periodicJob';

describe('periodicJob', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetPeriodicJobsForTests();
  });

  it('ignora uma segunda inicialização com o mesmo nome', async () => {
    vi.useFakeTimers();
    const runs = vi.fn();

    startPeriodicJob('job-duplicado', 1_000, runs, vi.fn());
    startPeriodicJob('job-duplicado', 1_000, runs, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('não sobrepõe uma execução que ainda está pendente', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const firstRun = new Promise<void>((resolve) => { release = resolve; });
    const runs = vi.fn(() => firstRun);

    startPeriodicJob('job-sobreposto', 1_000, runs, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('encaminha erro do job sem gerar rejeição não tratada', async () => {
    vi.useFakeTimers();
    const error = new Error('falha preventiva');
    const onError = vi.fn();

    startPeriodicJob('job-com-erro', 1_000, async () => { throw error; }, onError);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(error);
  });
});
