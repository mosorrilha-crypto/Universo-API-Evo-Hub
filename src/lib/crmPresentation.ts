/** Ausência, valores inválidos e zero são situações distintas. */
export function crmProbability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** ISO novo e datas da Ficha; prazos textuais antigos ficam intactos. */
export function formatCrmTaskDate(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return value;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly ? new Date(`${value}T12:00:00`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, dateOnly
    ? { dateStyle: 'short' }
    : { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
