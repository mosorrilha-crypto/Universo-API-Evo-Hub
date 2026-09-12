/**
 * Metadados de tenant que definem qual conteúdo fixo de camada usar no
 * prompt do agente — `segment` (camada 2, ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1) e `business_hours` (horário
 * de funcionamento por dia da semana, usado pelo agendamento real). Separado
 * de knowledgeBaseStore.ts porque é dado do tenant em si (tabela `tenants`),
 * não a base de conhecimento editável (camada 3).
 */
import { getDb, getPlatformDb } from './db';

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
  // TASK-0187 (parte 2) — achado real relatado ao vivo (01/09/2026): salvar
  // horário de atendimento sempre "funcionava" (sem erro, toast de sucesso)
  // mas nunca persistia — ao reabrir, voltava vazio. Causa: a tabela
  // `tenants` só tem policy RLS de SELECT pro papel `authenticated`
  // (confirmado via pg_policies), nenhuma de UPDATE — getDb() (cliente
  // tenant-scoped) faz o UPDATE sem erro nenhum, mas RLS filtra pra zero
  // linhas afetadas silenciosamente (comportamento padrão do Postgres/
  // PostgREST: UPDATE sem policy que autorize não é erro, só não atualiza
  // nada). getPlatformDb() é seguro aqui porque o `tenantId` já vem
  // verificado do JWT autenticado, nunca de input do cliente — mesmo
  // raciocínio já usado pros jobs de fundo (TASK-0083).
  const db = getPlatformDb();
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

/**
 * `admin_alert_phone` (número que recebe os alertas operacionais reais via
 * WhatsApp) + preferência por tipo de alerta — pedido direto (12/09/2026,
 * achado real: alertas de um tenant chegando no número de outro, porque o
 * `admin_alert_phone` só dava pra configurar via SQL direto no Supabase,
 * sem nenhuma tela). Cobre os 5 alertas administrativos do sistema, todos
 * via `adminAlertChannel.ts`/`sendAdminAlert`.
 *
 * `escalation`/`payment_pending` (TASK-0399, 12/09/2026) default **false**,
 * diferente dos outros 3: esses dois canais de WhatsApp foram removidos na
 * TASK-0298 porque um tenant real reclamou de receber alerta misturado com
 * as conversas reais de cliente no próprio WhatsApp. Ligar por padrão
 * reativaria silenciosamente o mesmo incômodo pra quem já reclamou — só
 * tenant que entrar na tela e ligar explicitamente passa a receber.
 */
export type AlertType = 'agent_paused' | 'evolution_disconnected' | 'system_error' | 'escalation' | 'payment_pending';

export type AlertPreferences = Record<AlertType, boolean>;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  agent_paused: true,
  evolution_disconnected: true,
  system_error: true,
  escalation: false,
  payment_pending: false,
};

const ALERT_TYPES = Object.keys(DEFAULT_ALERT_PREFERENCES) as AlertType[];

export interface TenantAlertSettings {
  adminAlertPhone: string | null;
  preferences: AlertPreferences;
}

export async function getTenantAlertSettings(tenantId: string): Promise<TenantAlertSettings> {
  const db = getDb();
  const { data } = await db.from('tenants').select('admin_alert_phone, alert_preferences').eq('id', tenantId).maybeSingle();
  const stored = (data?.alert_preferences as Partial<AlertPreferences> | null) || {};
  return {
    adminAlertPhone: (data?.admin_alert_phone as string | undefined) || null,
    preferences: { ...DEFAULT_ALERT_PREFERENCES, ...stored },
  };
}

/** Só dígitos, 8 a 15 (mesmo padrão de telefone já usado no resto do projeto — código do país + número, sem "+"/espaços). `null` explícito remove o número (desliga os 3 alertas). */
export function validateAdminAlertPhone(phone: unknown): phone is string | null {
  if (phone === null) return true;
  if (typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

export function validateAlertPreferences(prefs: unknown): prefs is Partial<AlertPreferences> {
  if (prefs === null || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  for (const [key, value] of Object.entries(prefs as Record<string, unknown>)) {
    if (!ALERT_TYPES.includes(key as AlertType)) return false;
    if (typeof value !== 'boolean') return false;
  }
  return true;
}

/**
 * `getPlatformDb()` de propósito, mesmo motivo já documentado em
 * `setTenantBusinessHours` acima: a tabela `tenants` só tem policy RLS de
 * SELECT pro papel `authenticated`, nenhuma de UPDATE — `getDb()` (cliente
 * tenant-scoped) faria o UPDATE sem erro nenhum, mas RLS filtraria pra zero
 * linhas afetadas, silenciosamente. `tenantId` já vem verificado do JWT
 * autenticado antes de chegar aqui, nunca de input do cliente.
 */
export async function setTenantAlertSettings(
  tenantId: string,
  patch: { adminAlertPhone?: string | null; preferences?: Partial<AlertPreferences> }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.adminAlertPhone !== undefined) {
    update.admin_alert_phone = patch.adminAlertPhone ? patch.adminAlertPhone.replace(/\D/g, '') : null;
  }
  if (patch.preferences !== undefined) {
    const current = await getTenantAlertSettings(tenantId);
    update.alert_preferences = { ...current.preferences, ...patch.preferences };
  }
  if (Object.keys(update).length === 0) return;
  const db = getPlatformDb();
  const { error } = await db.from('tenants').update(update).eq('id', tenantId);
  if (error) throw error;
}

/**
 * Preferências por tenant pras mensagens automáticas mandadas pro CLIENTE
 * final (não pro dono do tenant — isso é `AlertPreferences` acima) — pedido
 * direto (12/09/2026): "o que enviar, quando enviar e se quer enviar".
 * Cobre os 3 comportamentos hoje hardcoded pra todo tenant: lembrete de
 * agendamento (`reminderJob.ts`), retomada de conversa parada
 * (`operatorFollowUpService.ts`) e acompanhamento automático de funil
 * (`pendingFollowUpJob.ts`/`webhooks.ts`). Coluna própria
 * (`customer_notification_preferences`), separada de `alert_preferences`:
 * esta tem parâmetros numéricos/horário aninhados por tipo, não só booleano.
 *
 * Os defaults abaixo reproduzem EXATAMENTE as constantes hardcoded de hoje
 * (72h de antecedência, 08:30/07:30 de corte, sempre-liga da retomada,
 * 2.5h/7h-19h do funil) — nenhum tenant existente muda de comportamento até
 * entrar na tela e mexer em algo.
 */
export interface AppointmentReminderPreferences {
  enabled: boolean;
  diaAnteriorEnabled: boolean;
  /** Só manda o lembrete de véspera se o agendamento foi feito com pelo menos esta antecedência (horas). */
  diaAnteriorMinLeadHours: number;
  /** "HH:mm" — não manda o lembrete de véspera antes deste horário. */
  diaAnteriorEarliestTime: string;
  mesmoDiaEnabled: boolean;
  /** "HH:mm" — não manda o lembrete do mesmo dia antes deste horário. */
  mesmoDiaEarliestTime: string;
}

export interface AbandonedConversationReactivationPreferences {
  /** Quando false, a orientação do operador continua salva e é usada assim que o cliente responder por conta própria — só o envio proativo do template fora da janela de 24h é que não acontece. */
  enabled: boolean;
}

export interface FunnelAutoFollowUpPreferences {
  enabled: boolean;
  /** Quantas horas esperar em silêncio antes de tentar reengajar automaticamente. */
  delayHours: number;
  /** Hora local (0-23) a partir da qual a tentativa automática pode ocorrer. */
  businessHoursStart: number;
  /** Hora local (1-24) até a qual a tentativa automática pode ocorrer. */
  businessHoursEnd: number;
}

export interface CustomerNotificationPreferences {
  appointmentReminders: AppointmentReminderPreferences;
  abandonedConversationReactivation: AbandonedConversationReactivationPreferences;
  funnelAutoFollowUp: FunnelAutoFollowUpPreferences;
}

export const DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES: CustomerNotificationPreferences = {
  appointmentReminders: {
    enabled: true,
    diaAnteriorEnabled: true,
    diaAnteriorMinLeadHours: 72,
    diaAnteriorEarliestTime: '08:30',
    mesmoDiaEnabled: true,
    mesmoDiaEarliestTime: '07:30',
  },
  abandonedConversationReactivation: {
    enabled: true,
  },
  funnelAutoFollowUp: {
    enabled: true,
    delayHours: 2.5,
    businessHoursStart: 7,
    businessHoursEnd: 19,
  },
};

/** Converte `funnelAutoFollowUp.delayHours` pra ms — evita duplicar a conta em pendingFollowUpJob.ts e webhooks.ts (que precisam concordar no mesmo prazo). */
export function funnelAutoFollowUpDelayMs(prefs: FunnelAutoFollowUpPreferences): number {
  return prefs.delayHours * 60 * 60 * 1000;
}

export async function getTenantCustomerNotificationPreferences(tenantId: string): Promise<CustomerNotificationPreferences> {
  const db = getDb();
  const { data } = await db.from('tenants').select('customer_notification_preferences').eq('id', tenantId).maybeSingle();
  const stored = (data?.customer_notification_preferences as Partial<CustomerNotificationPreferences> | null) || {};
  return {
    appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, ...stored.appointmentReminders },
    abandonedConversationReactivation: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.abandonedConversationReactivation, ...stored.abandonedConversationReactivation },
    funnelAutoFollowUp: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.funnelAutoFollowUp, ...stored.funnelAutoFollowUp },
  };
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Valida a forma de `Partial<CustomerNotificationPreferences>` antes de
 * gravar — mesma cautela de `validateBusinessHours`/`validateAlertPreferences`
 * acima: os jobs confiam cegamente nesses valores, um número fora de faixa
 * ou um "HH:mm" mal formado quebraria a lógica de horário silenciosamente.
 */
export function validateCustomerNotificationPreferences(prefs: unknown): prefs is Partial<CustomerNotificationPreferences> {
  if (prefs === null || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  const allowedGroups = ['appointmentReminders', 'abandonedConversationReactivation', 'funnelAutoFollowUp'];
  for (const [group, value] of Object.entries(prefs as Record<string, unknown>)) {
    if (!allowedGroups.includes(group)) return false;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = value as Record<string, unknown>;

    if (group === 'appointmentReminders') {
      for (const [key, v] of Object.entries(fields)) {
        if (key === 'enabled' || key === 'diaAnteriorEnabled' || key === 'mesmoDiaEnabled') {
          if (typeof v !== 'boolean') return false;
        } else if (key === 'diaAnteriorMinLeadHours') {
          if (!isFiniteNumberInRange(v, 0, 168)) return false;
        } else if (key === 'diaAnteriorEarliestTime' || key === 'mesmoDiaEarliestTime') {
          if (typeof v !== 'string' || !HHMM_RE.test(v)) return false;
        } else {
          return false;
        }
      }
    } else if (group === 'abandonedConversationReactivation') {
      for (const [key, v] of Object.entries(fields)) {
        if (key !== 'enabled' || typeof v !== 'boolean') return false;
      }
    } else if (group === 'funnelAutoFollowUp') {
      if (
        typeof fields.businessHoursStart === 'number' &&
        typeof fields.businessHoursEnd === 'number' &&
        fields.businessHoursStart >= fields.businessHoursEnd
      ) {
        return false;
      }
      for (const [key, v] of Object.entries(fields)) {
        if (key === 'enabled') {
          if (typeof v !== 'boolean') return false;
        } else if (key === 'delayHours') {
          if (!isFiniteNumberInRange(v, 0.5, 24)) return false;
        } else if (key === 'businessHoursStart') {
          if (!isFiniteNumberInRange(v, 0, 23)) return false;
        } else if (key === 'businessHoursEnd') {
          if (!isFiniteNumberInRange(v, 1, 24)) return false;
        } else {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * `getPlatformDb()` de propósito — mesmo motivo já documentado em
 * `setTenantBusinessHours`/`setTenantAlertSettings` acima (tabela `tenants`
 * sem policy RLS de UPDATE pro cliente tenant-scoped). Faz merge por GRUPO
 * (não um spread raso único): salvar só `funnelAutoFollowUp` nunca deve
 * apagar customizações já salvas em `appointmentReminders`.
 */
export async function setTenantCustomerNotificationPreferences(
  tenantId: string,
  patch: Partial<CustomerNotificationPreferences>
): Promise<void> {
  const current = await getTenantCustomerNotificationPreferences(tenantId);
  const merged: CustomerNotificationPreferences = {
    appointmentReminders: { ...current.appointmentReminders, ...patch.appointmentReminders },
    abandonedConversationReactivation: { ...current.abandonedConversationReactivation, ...patch.abandonedConversationReactivation },
    funnelAutoFollowUp: { ...current.funnelAutoFollowUp, ...patch.funnelAutoFollowUp },
  };
  const db = getPlatformDb();
  const { error } = await db.from('tenants').update({ customer_notification_preferences: merged }).eq('id', tenantId);
  if (error) throw error;
}
