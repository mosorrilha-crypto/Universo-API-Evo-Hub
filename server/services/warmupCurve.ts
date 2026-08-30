/**
 * Curva de aquecimento pra número novo de disparo em massa (TASK-0171) —
 * NÃO é uma regra oficial da Meta (ela não publica um cronograma fixo),
 * é a prática de mercado recomendada por provedores do WhatsApp Business
 * Platform: começar bem baixo e subir aos poucos, só enquanto a qualidade
 * do número (`broadcast_numbers.quality_rating`) continuar Alta/Média.
 *
 * `warmupProgressDays` NÃO é "dias desde a conexão do número" — é um
 * contador que só avança 1x por dia corrido quando a qualidade está boa
 * (ver broadcastSenderJob.ts). Um número com qualidade ruim ou nunca
 * conferida fica congelado no patamar atual em vez de continuar subindo só
 * por ter passado tempo.
 */

const WARMUP_CURVE: Array<{ minDay: number; cap: number }> = [
  { minDay: 0, cap: 40 },
  { minDay: 4, cap: 100 },
  { minDay: 8, cap: 250 },
  { minDay: 15, cap: 1000 },
];

/** Teto de mensagens/dia sugerido pelo patamar atual da curva, antes de aplicar o teto final configurado pro número. */
export function warmupCurveCapForDay(warmupProgressDays: number): number {
  let cap = WARMUP_CURVE[0].cap;
  for (const step of WARMUP_CURVE) {
    if (warmupProgressDays >= step.minDay) cap = step.cap;
  }
  return cap;
}

/** Teto de mensagens/dia de verdade pro número: nunca passa do teto final configurado (`daily_cap`), mesmo que a curva já sugira mais. */
export function effectiveDailyCap(warmupProgressDays: number, configuredDailyCap: number): number {
  return Math.min(configuredDailyCap, warmupCurveCapForDay(warmupProgressDays));
}

/** true quando o patamar atual da curva já alcança/ultrapassa o teto configurado — o número pode sair de "warming" pra "active". */
export function hasCompletedWarmup(warmupProgressDays: number, configuredDailyCap: number): boolean {
  return warmupCurveCapForDay(warmupProgressDays) >= configuredDailyCap;
}
