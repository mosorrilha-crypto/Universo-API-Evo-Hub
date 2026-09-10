/**
 * Janela de horário comercial do Disparo em Massa (TASK-0173, evolução do
 * gap identificado em TASK-0171: `scheduled_at` existia no schema mas nada
 * lia esse campo, e não havia nenhuma restrição de horário respeitada pelo
 * job de envio). `sendWindowStart`/`sendWindowEnd` são "HH:MM" (24h) no fuso
 * `sendWindowTimezone` de cada campanha — os dois nulos significa "sem
 * restrição", preservando o comportamento de qualquer campanha criada antes
 * desta mudança.
 */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeOfDay(value: string): boolean {
  return HHMM_RE.test(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function parseHHMMToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Minuto do dia (0–1439) de `date` já convertido pro fuso `timezone`. */
function localMinuteOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * `start`/`end` nulos (ou iguais entre si) = sem restrição, sempre `true`.
 * Suporta janela que cruza a meia-noite (ex.: 22:00–06:00) tratando `start >
 * end` como "das start até 23:59 OU da meia-noite até end".
 */
export function isWithinSendWindow(
  now: Date,
  start: string | null,
  end: string | null,
  timezone: string
): boolean {
  if (!start || !end) return true;
  const startMinutes = parseHHMMToMinutes(start);
  const endMinutes = parseHHMMToMinutes(end);
  if (startMinutes === endMinutes) return true;

  const nowMinutes = localMinuteOfDay(now, timezone);
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
