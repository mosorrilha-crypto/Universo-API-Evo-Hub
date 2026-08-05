/**
 * Serializa operações assíncronas por número de telefone — garante que a
 * resposta automática de uma mensagem termine (ou desista) antes de começar
 * a processar a próxima do MESMO número, evitando respostas fora de ordem
 * quando o Gemini demora mais numa chamada do que na seguinte.
 */
const queues = new Map<string, Promise<unknown>>();

export function runExclusive<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(phone) || Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(phone, next.catch(() => {}));
  return next;
}
