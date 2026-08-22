type PeriodicRun = () => Promise<void> | void;
type PeriodicErrorHandler = (error: unknown) => void;

const startedJobs = new Set<string>();
const runningJobs = new Set<string>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Inicia um job periódico uma única vez por processo e evita que um tick novo
 * entre enquanto a execução anterior ainda está em andamento. Isso não
 * substitui uma trava distribuída entre réplicas, mas impede duplicação
 * acidental por bootstrap repetido e rajadas sobrepostas no mesmo processo.
 */
export function startPeriodicJob(
  name: string,
  intervalMs: number,
  run: PeriodicRun,
  onError: PeriodicErrorHandler,
): void {
  if (startedJobs.has(name)) {
    console.warn(`⚠️ [Jobs] ${name} já foi iniciado neste processo — inicialização duplicada ignorada.`);
    return;
  }
  startedJobs.add(name);

  const tick = () => {
    if (runningJobs.has(name)) {
      console.warn(`⚠️ [Jobs] ${name} ainda está executando — tick sobreposto ignorado.`);
      return;
    }

    runningJobs.add(name);
    Promise.resolve()
      .then(run)
      .catch((error) => {
        try {
          onError(error);
        } catch (handlerError) {
          console.warn(`⚠️ [Jobs] ${name} falhou ao tratar o próprio erro: ${describeError(handlerError)}`);
        }
      })
      .finally(() => runningJobs.delete(name));
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  // O servidor HTTP mantém o processo vivo; o timer não deve impedir um
  // encerramento limpo em testes, scripts administrativos ou shutdown.
  (timer as NodeJS.Timeout).unref?.();
}

/** Exclusivo para testes: limpa o estado de bootstrap sem afetar jobs em produção. */
export function resetPeriodicJobsForTests(): void {
  startedJobs.clear();
  runningJobs.clear();
}
