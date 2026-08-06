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
