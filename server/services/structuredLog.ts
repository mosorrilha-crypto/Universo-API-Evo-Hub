/**
 * Log estruturado mínimo por tenant — não é Sentry/observability pesada
 * (ver issue #184, baixa prioridade até ter um gatilho concreto), só
 * disciplina de formato consistente pra dar pra filtrar/agregar no log
 * bruto do Render sem esforço de infra nenhum.
 *
 * Motivação real (19/08/2026): o `invalid_grant` recorrente do Google
 * Calendar (job de lembretes) só foi descoberto por leitura manual de log
 * solto, sem `tenant_id`/latência/outcome estruturado — não dava pra saber
 * de qual tenant era, nem há quanto tempo vinha falhando, sem grep manual.
 */
export interface StructuredLogFields {
  tenantId: string;
  /** Área/serviço que gerou o evento — ex: 'autoReply', 'googleCalendar', 'appointmentStore'. */
  area: string;
  /** Operação específica dentro da área — ex: 'router', 'especialista', 'listUpcomingEvents', 'confirmPayment'. */
  op: string;
  outcome: 'success' | 'error';
  latencyMs?: number;
  /** Texto curto livre — ex: agente classificado, motivo do erro. Nunca dado sensível (token, mensagem do cliente). */
  detail?: string;
}

/** Uma linha por evento, grep-ável por qualquer campo (`tenant=`, `area=`, `op=`, `outcome=`). */
export function logStructured(fields: StructuredLogFields): void {
  const parts = [
    `tenant=${fields.tenantId}`,
    `area=${fields.area}`,
    `op=${fields.op}`,
    `outcome=${fields.outcome}`,
    fields.latencyMs !== undefined ? `latency_ms=${fields.latencyMs}` : null,
    fields.detail ? `detail="${fields.detail.replace(/"/g, "'")}"` : null,
  ].filter(Boolean);
  const line = `[LOG] ${parts.join(' ')}`;
  if (fields.outcome === 'error') console.warn(line);
  else console.log(line);
}

/** Envolve uma operação assíncrona, medindo latência e logando outcome — rethrow sempre em erro, nunca engole a falha. */
export async function withStructuredLog<T>(
  fields: Omit<StructuredLogFields, 'outcome' | 'latencyMs' | 'detail'>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logStructured({ ...fields, outcome: 'success', latencyMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    logStructured({ ...fields, outcome: 'error', latencyMs: Date.now() - startedAt, detail: (err as Error)?.message || String(err) });
    throw err;
  }
}
