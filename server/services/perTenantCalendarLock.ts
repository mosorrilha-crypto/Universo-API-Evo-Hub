/**
 * Serializa criar_agendamento/remarcar_agendamento por tenant (16/08/2026,
 * "Opção A" — ver docs/AGENTE-VERTICAL-ARQUITETURA.md seção 4.3): sem isso,
 * duas mensagens quase simultâneas do MESMO cliente (ou dois clientes
 * diferentes disputando o mesmo horário) podiam rodar a checagem de
 * disponibilidade e a criação do evento em paralelo — cada chamada via a
 * agenda livre porque a outra ainda não tinha escrito o evento, e as duas
 * criavam eventos reais sobrepostos no Google Calendar. Mesmo padrão de
 * `perPhoneQueue.ts` (mutex em memória via Map<chave, Promise>), mas
 * chaveado por tenantId em vez de phone — o conflito é sobre a AGENDA do
 * tenant inteiro, não sobre a conversa de um telefone só.
 */
const queues = new Map<string, Promise<unknown>>();

export function runExclusiveForTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(tenantId) || Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(tenantId, next.catch(() => {}));
  return next;
}
