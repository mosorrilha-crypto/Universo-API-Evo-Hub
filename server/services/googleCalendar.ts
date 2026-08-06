/**
 * Integração real com Google Calendar (OAuth + eventos) — permite o agente
 * de agendamento consultar disponibilidade real e criar/reagendar/cancelar
 * consultas de verdade, em vez de só escalar pra humano.
 *
 * Fluxo de conexão: o operador clica "Conectar Google Calendar" no painel,
 * autoriza no Google, o backend recebe o código no callback e troca por um
 * refresh token — guardado no Supabase Storage (mesmo padrão de todo o
 * resto do projeto), nunca em variável de ambiente (evita precisar de
 * redeploy toda vez que reconectar).
 */
import { google } from 'googleapis';
import { getDb } from './db';

// Evita importar o tipo OAuth2Client de 'google-auth-library' diretamente —
// o pacote 'googleapis' reexporta uma cópia própria (via googleapis-common)
// que o TypeScript trata como um tipo DIFERENTE, mesmo sendo estruturalmente
// idêntico. InstanceType<typeof google.auth.OAuth2> sempre bate com o que
// google.calendar({auth}) espera, não importa qual cópia é resolvida.
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Token por tenant, na tabela Postgres `tenant_calendar_tokens` (Bloco 2.A) —
 * substitui o único arquivo `google-calendar-token.json` global no Supabase
 * Storage. O parâmetro `state` do fluxo OAuth ainda não carrega o tenantId
 * (isso é Bloco 2.C); por ora quem chama passa o tenant explicitamente.
 */
async function loadRefreshToken(tenantId: string): Promise<string | null> {
  const db = getDb();
  const { data } = await db.from('tenant_calendar_tokens').select('refresh_token').eq('tenant_id', tenantId).maybeSingle();
  return data?.refresh_token || null;
}

async function saveRefreshToken(tenantId: string, refreshToken: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('tenant_calendar_tokens')
    .upsert({ tenant_id: tenantId, refresh_token: refreshToken, connected_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

function createOAuthClient(clientId?: string, clientSecret?: string, redirectUri?: string): OAuth2Client {
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** URL de consentimento — o operador clica num link que leva aqui. */
export function getGoogleAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
  const client = createOAuthClient(clientId, clientSecret, redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline', // necessário pra ganhar um refresh_token
    prompt: 'consent', // força reconsentimento, garantindo que o refresh_token venha mesmo em reconexões
    scope: SCOPES,
  });
}

/** Troca o código do callback por tokens e guarda o refresh token. */
export async function handleGoogleOAuthCallback(
  tenantId: string,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<void> {
  const client = createOAuthClient(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google não devolveu um refresh_token — desconecte o app em myaccount.google.com/permissions e tente conectar de novo (o consentimento precisa ser "fresco").');
  }
  await saveRefreshToken(tenantId, tokens.refresh_token);
}

export async function isGoogleCalendarConnected(tenantId: string): Promise<boolean> {
  return !!(await loadRefreshToken(tenantId));
}

export async function disconnectGoogleCalendar(tenantId: string): Promise<void> {
  const db = getDb();
  await db.from('tenant_calendar_tokens').delete().eq('tenant_id', tenantId);
}

/** Cliente OAuth autenticado, pronto pra chamar a Calendar API — renova o access token sozinho a partir do refresh token. */
async function getAuthorizedClient(tenantId: string, clientId?: string, clientSecret?: string, redirectUri?: string): Promise<OAuth2Client> {
  const refreshToken = await loadRefreshToken(tenantId);
  if (!refreshToken) {
    throw new Error('Google Calendar não está conectado. Conecte no painel antes de agendar.');
  }
  const client = createOAuthClient(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface CalendarConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

/** Offset (ms) de um fuso IANA num instante específico — soma no instante UTC pra obter a hora "de parede" local nesse fuso, naquele momento (correto mesmo em transições de horário de verão). */
function getUtcOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const asUtcMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(hour), Number(map.minute), Number(map.second));
  return asUtcMs - instantMs;
}

/**
 * Converte "YYYY-MM-DDTHH:mm:ss" (hora LOCAL no fuso informado, sem offset —
 * o formato que pedimos ao agente de IA, pra ele não precisar calcular
 * offset de fuso horário) pro instante UTC real em ISO com "Z".
 *
 * Só é preciso pro freebusy.query: diferente de events.insert/patch (que
 * aceitam dateTime sem offset + um campo timeZone separado pra interpretar),
 * o freebusy.query exige timeMin/timeMax já em RFC3339 com offset explícito.
 */
export function localNaiveToUtcIso(naiveLocal: string, timeZone: string): string {
  const guessMs = new Date(`${naiveLocal}Z`).getTime();
  const offsetMs = getUtcOffsetMs(guessMs, timeZone);
  return new Date(guessMs - offsetMs).toISOString();
}

/** Verifica se um intervalo está livre na agenda primária. startIso/endIso: hora local (sem offset) no fuso `timezone`. */
export async function checkFreeBusy(tenantId: string, cfg: CalendarConfig, startIso: string, endIso: string, timezone = 'America/Asuncion'): Promise<boolean> {
  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  const timeMin = localNaiveToUtcIso(startIso, timezone);
  const timeMax = localNaiveToUtcIso(endIso, timezone);
  const res = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] },
  });
  const busy = res.data.calendars?.primary?.busy || [];
  return busy.length === 0;
}

export async function createCalendarEvent(
  tenantId: string,
  cfg: CalendarConfig,
  summary: string,
  description: string,
  startIso: string,
  endIso: string,
  timezone = 'America/Asuncion'
): Promise<string> {
  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: startIso, timeZone: timezone },
      end: { dateTime: endIso, timeZone: timezone },
    },
  });
  if (!res.data.id) throw new Error('Google não retornou o ID do evento criado.');
  return res.data.id;
}

export async function rescheduleCalendarEvent(
  tenantId: string,
  cfg: CalendarConfig,
  eventId: string,
  newStartIso: string,
  newEndIso: string,
  timezone = 'America/Asuncion'
): Promise<void> {
  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: {
      start: { dateTime: newStartIso, timeZone: timezone },
      end: { dateTime: newEndIso, timeZone: timezone },
    },
  });
}

export async function cancelCalendarEvent(tenantId: string, cfg: CalendarConfig, eventId: string): Promise<void> {
  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

export interface UpcomingEvent {
  id: string;
  summary: string;
  startIso: string;
  description?: string;
}

/** Lista eventos entre duas datas — usado pelo job de lembretes automáticos. */
export async function listUpcomingEvents(tenantId: string, cfg: CalendarConfig, timeMinIso: string, timeMaxIso: string): Promise<UpcomingEvent[]> {
  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return (res.data.items || [])
    .filter((e) => e.id && e.summary && e.start?.dateTime)
    .map((e) => ({ id: e.id!, summary: e.summary!, startIso: e.start!.dateTime!, description: e.description || undefined }));
}
