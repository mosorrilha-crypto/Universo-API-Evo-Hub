/**
 * Job de acompanhamento de funil (pedido real, 15/08/2026 — auditoria de
 * conversas reais do dia mostrou ZERO agendamentos fechados apesar de 31
 * conversas ativas). Duas situações que hoje deixavam um lead esfriar sem
 * ninguém saber, marcadas em server/services/pendingFollowUpStore.ts:
 *
 * - 'owner_review': a IA pediu uma foto/dado pra Monique avaliar (trabalho
 *   anterior, pigmento antigo) antes de definir o procedimento, e ainda não
 *   tem a decisão dela. Vence no fim do dia útil.
 * - 'customer_reply': a IA ofereceu horário/opção e o cliente sumiu antes de
 *   responder. Vence ~2h30 depois.
 *
 * Mesma cautela de preReservationFollowUpJob.ts/agentPausedAlertJob.ts:
 * NUNCA reabre contato com o cliente sozinho — só escala pro operador humano
 * via Escalonamentos (logEscalation), que já calcula sozinho se a janela de
 * 24h da Meta ainda está aberta (GET /api/escalations, withinServiceWindow).
 */
import { listTenantIdsWithPendingFollowUps, listPendingFollowUps, markFollowUpAlerted, type PendingFollowUp } from './pendingFollowUpStore';
import { logEscalation } from './escalationStore';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function reasonForAlert(p: PendingFollowUp): string {
  if (p.kind === 'owner_review') {
    return `Cliente esperando avaliação antes de definir o procedimento (${p.reason}) — ainda sem decisão até o fim do dia.`;
  }
  return `Ofereceu horário/opção e o cliente sumiu sem responder (${p.reason}) — esfriou, pode precisar de um empurrãozinho.`;
}

async function checkPendingFollowUpsForTenant(tenantId: string, nowIso: string): Promise<void> {
  let pending: PendingFollowUp[];
  try {
    pending = await listPendingFollowUps(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Acompanhamento de funil] tenant=${tenantId} falha ao listar pendências:`, (err as Error).message);
    return;
  }

  for (const p of pending) {
    if (p.dueAt > nowIso) continue; // ainda não venceu

    try {
      await logEscalation(tenantId, p.phone, p.contactName, reasonForAlert(p), undefined, p.kind);
      await markFollowUpAlerted(tenantId, p.id);
      console.log(`🔔 [Acompanhamento de funil] tenant=${tenantId} escalou ${p.kind} pra ${p.phone} (pendente desde ${p.createdAt}).`);
    } catch (err) {
      console.warn(`⚠️  [Acompanhamento de funil] tenant=${tenantId} falha ao escalar pendência ${p.id}:`, (err as Error).message);
    }
  }
}

/** Uma passada do job — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkPendingFollowUps(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithPendingFollowUps();
  } catch (err) {
    console.warn('⚠️  [Acompanhamento de funil] Falha ao listar tenants com pendência:', (err as Error).message);
    return;
  }
  const nowIso = new Date().toISOString();
  for (const tenantId of tenantIds) {
    await checkPendingFollowUpsForTenant(tenantId, nowIso);
  }
}

export interface PendingFollowUpJobDeps {
  intervalMs?: number;
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startPreReservationFollowUpJob. */
export function startPendingFollowUpJob(deps: PendingFollowUpJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = () => checkPendingFollowUps().catch((err) => console.warn('⚠️  [Acompanhamento de funil] Erro no job:', err.message));
  run();
  setInterval(run, intervalMs);
}
