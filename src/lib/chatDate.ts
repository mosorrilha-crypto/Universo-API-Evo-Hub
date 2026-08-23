export type ChatDateParts = {
  key: string | null;
  date: Date | null;
};

const dateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getChatDateParts(timestamp: string | null | undefined, now = new Date()): ChatDateParts {
  const value = String(timestamp || '').trim();
  if (!value) return { key: null, date: null };

  // Mensagens antigas de demonstração guardam apenas HH:MM. Elas pertencem
  // ao dia atual, mas não devem inventar uma data histórica.
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) {
    return { key: dateKey(now), date: now };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { key: null, date: null };
  return { key: dateKey(parsed), date: parsed };
}

export function isNewChatDateGroup(
  timestamp: string | null | undefined,
  previousTimestamp: string | null | undefined,
): boolean {
  const current = getChatDateParts(timestamp);
  const previous = getChatDateParts(previousTimestamp);

  if (current.key === null) return false;
  return current.key !== previous.key;
}

export function formatChatDateLabel(
  timestamp: string | null | undefined,
  isSpanish: boolean,
  now = new Date(),
): string | null {
  const parts = getChatDateParts(timestamp, now);
  if (!parts.date || !parts.key) return null;

  const todayKey = dateKey(now);
  if (parts.key === todayKey) return isSpanish ? 'Hoy' : 'Hoje';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (parts.key === dateKey(yesterday)) return isSpanish ? 'Ayer' : 'Ontem';

  return new Intl.DateTimeFormat(isSpanish ? 'es-PY' : 'pt-BR', {
    day: '2-digit',
    month: 'long',
    year: parts.date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(parts.date);
}
