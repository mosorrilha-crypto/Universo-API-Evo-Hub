/**
 * Metadados de tenant que definem qual conteúdo fixo de camada usar no
 * prompt do agente — `segment` (camada 2, ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1) e `business_hours` (horário
 * de funcionamento por dia da semana, usado pelo agendamento real). Separado
 * de knowledgeBaseStore.ts porque é dado do tenant em si (tabela `tenants`),
 * não a base de conhecimento editável (camada 3).
 */
import { getDb } from './db';

/**
 * Achado numa auditoria: era 'beauty_studio' — qualquer tenant sem segmento
 * resolvido (linha não encontrada, coluna vazia) herdava sem querer as
 * regras de clínica de estética. 'generic' não bate com nenhuma chave de
 * SEGMENT_LAYERS (autoReply.ts) — resultado: só a Camada 1 (Global) se
 * aplica, sem nenhuma regra de segmento errada. Ver também
 * 0027_tenant_segment_default_generic.sql (mesmo default na coluna em si).
 */
export const DEFAULT_SEGMENT = 'generic';

export async function getTenantSegment(tenantId: string): Promise<string> {
  const db = getDb();
  const { data } = await db.from('tenants').select('segment').eq('id', tenantId).maybeSingle();
  return (data?.segment as string | undefined) || DEFAULT_SEGMENT;
}

export type ReminderLanguage = 'es' | 'pt';

/**
 * Idioma do lembrete automático de agendamento (reminderJob.ts) — achado
 * real em produção (20/08/2026): o texto do lembrete era fixo em português,
 * mesmo pra tenants/leads de língua espanhola (o único tenant real hoje é
 * paraguaio). reminderJob.ts é determinístico (não passa pelo Gemini), então
 * não tem como "detectar" idioma ali — precisa desta configuração explícita.
 * Default 'es' (migration 0038) — nunca 'pt' por acidente pra um tenant
 * novo sem configurar nada.
 */
export async function getTenantReminderLanguage(tenantId: string): Promise<ReminderLanguage> {
  const db = getDb();
  const { data } = await db.from('tenants').select('reminder_language').eq('id', tenantId).maybeSingle();
  return data?.reminder_language === 'pt' ? 'pt' : 'es';
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

const WEEKDAY_NAMES: Record<string, string> = {
  '1': 'Segunda', '2': 'Terça', '3': 'Quarta', '4': 'Quinta', '5': 'Sexta', '6': 'Sábado', '0': 'Domingo',
};
const WEEKDAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

/**
 * Texto pronto pra injetar no prompt do agente — única fonte de horário de
 * funcionamento que o agente consulta pra QUALQUER tipo de mensagem
 * (triagem/faq/agendamento/reclamação), sempre calculado a partir do valor
 * real cadastrado. Antes disso o horário só chegava ao agente de duas
 * formas: um texto solto duplicado na base de conhecimento (podia divergir
 * do valor real sem nenhum aviso) e um status calculado em tempo real, mas
 * só quando o roteador classificava a mensagem como "agendamento" — uma
 * pergunta casual de FAQ ("que horas vocês abrem?") nunca via o valor real,
 * só o texto solto (achado real: um novo tenant/funcionário sem saber que
 * precisava atualizar os dois lugares deixaria essa pergunta respondida
 * errado). `describeBusinessHoursToday` (autoReply.ts) continua existindo à
 * parte — ele resolve um problema diferente e mais específico (se está
 * aberto AGORA, pro fluxo de agendamento nunca oferecer "hoje" já fechado).
 */
export function formatBusinessHoursForPrompt(hours: BusinessHours | null): string {
  if (!hours) return '';
  const lines = WEEKDAY_ORDER
    .filter((day) => hours[day])
    .map((day) => `${WEEKDAY_NAMES[day]}: ${hours[day]!.open} às ${hours[day]!.close}`);
  if (!lines.length) return '';
  return `Horário de funcionamento:\n${lines.join('\n')}`;
}
