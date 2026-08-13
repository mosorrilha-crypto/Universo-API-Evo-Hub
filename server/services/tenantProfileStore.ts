/**
 * Metadados de tenant que definem qual conteúdo fixo de camada usar no
 * prompt do agente — `segment` (camada 2, ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1) e `business_hours` (horário
 * de funcionamento por dia da semana, usado pelo agendamento real). Separado
 * de knowledgeBaseStore.ts porque é dado do tenant em si (tabela `tenants`),
 * não a base de conhecimento editável (camada 3).
 */
import { getDb } from './db';

export const DEFAULT_SEGMENT = 'beauty_studio';

export async function getTenantSegment(tenantId: string): Promise<string> {
  const db = getDb();
  const { data } = await db.from('tenants').select('segment').eq('id', tenantId).maybeSingle();
  return (data?.segment as string | undefined) || DEFAULT_SEGMENT;
}

/** "HH:mm" de abertura/fechamento de um dia específico. */
export interface DayHours {
  open: string;
  close: string;
}

/** Chaveado por dia da semana ("0" domingo .. "6" sábado, convenção Date.getUTCDay()). Dia ausente = tenant não atende nesse dia. */
export type BusinessHours = Partial<Record<string, DayHours>>;

/** null quando o tenant nunca configurou horário — nesse caso o agendamento não é restringido por expediente (só pelo que já estiver ocupado no Google Calendar). */
export async function getTenantBusinessHours(tenantId: string): Promise<BusinessHours | null> {
  const db = getDb();
  const { data } = await db.from('tenants').select('business_hours').eq('id', tenantId).maybeSingle();
  return (data?.business_hours as BusinessHours | undefined) || null;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Valida a forma de `BusinessHours` antes de gravar — o agendamento real
 * (describeBusinessHoursToday/isWithinBusinessHours em autoReply.ts e
 * googleCalendar.ts) confia cegamente nesses valores pra decidir se pode
 * oferecer um horário ao cliente; um "HH:mm" mal formado ou um close <= open
 * quebraria essa lógica silenciosamente (nunca no agendamento em si, que só
 * lança erro pra invocação isolada — quebraria a checagem proativa que
 * sugere horários, deixando tudo parecer "sem disponibilidade nenhuma").
 */
export function validateBusinessHours(hours: unknown): hours is BusinessHours {
  if (hours === null || typeof hours !== 'object' || Array.isArray(hours)) return false;
  for (const [day, dayHours] of Object.entries(hours as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day)) return false;
    if (dayHours == null) continue; // dia ausente/null = tenant não atende nesse dia
    if (typeof dayHours !== 'object') return false;
    const { open, close } = dayHours as Record<string, unknown>;
    if (typeof open !== 'string' || typeof close !== 'string') return false;
    if (!HHMM_RE.test(open) || !HHMM_RE.test(close)) return false;
    if (open >= close) return false; // "HH:mm" compara corretamente como string (largura fixa)
  }
  return true;
}

export async function setTenantBusinessHours(tenantId: string, hours: BusinessHours): Promise<void> {
  const db = getDb();
  const { error } = await db.from('tenants').update({ business_hours: hours }).eq('id', tenantId);
  if (error) throw error;
}
