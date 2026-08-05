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

// Evita importar o tipo OAuth2Client de 'google-auth-library' diretamente —
// o pacote 'googleapis' reexporta uma cópia própria (via googleapis-common)
// que o TypeScript trata como um tipo DIFERENTE, mesmo sendo estruturalmente
// idêntico. InstanceType<typeof google.auth.OAuth2> sempre bate com o que
// google.calendar({auth}) espera, não importa qual cópia é resolvida.
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const BUCKET = 'app-data';
const OBJECT_PATH = 'google-calendar-token.json';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;
let storedRefreshToken: string | null = null;

export function initGoogleCalendarPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };
}

async function loadRefreshToken(): Promise<string | null> {
  if (storedRefreshToken) return storedRefreshToken;
  if (!persistence) return null;
  try {
    const res = await fetch(`${persistence.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: persistence.supabaseKey, Authorization: `Bearer ${persistence.supabaseKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { refreshToken?: string };
    storedRefreshToken = data.refreshToken || null;
    return storedRefreshToken;
  } catch (err) {
    console.warn('⚠️  [Google Calendar] Falha ao carregar token:', (err as Error).message);
    return null;
  }
}

async function saveRefreshToken(refreshToken: string): Promise<void> {
  storedRefreshToken = refreshToken;
  if (!persistence) return;
  try {
    await fetch(`${persistence.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'POST',
      headers: {
        apikey: persistence.supabaseKey,
        Authorization: `Bearer ${persistence.supabaseKey}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    console.warn('⚠️  [Google Calendar] Falha ao salvar token:', (err as Error).message);
  }
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
  await saveRefreshToken(tokens.refresh_token);
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  return !!(await loadRefreshToken());
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await saveRefreshToken('');
  storedRefreshToken = null;
}

/** Cliente OAuth autenticado, pronto pra chamar a Calendar API — renova o access token sozinho a partir do refresh token. */
async function getAuthorizedClient(clientId?: string, clientSecret?: string, redirectUri?: string): Promise<OAuth2Client> {
  const refreshToken = await loadRefreshToken();
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

/** Verifica se um intervalo está livre na agenda primária. */
export async function checkFreeBusy(cfg: CalendarConfig, startIso: string, endIso: string): Promise<boolean> {
  const auth = await getAuthorizedClient(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.freebusy.query({
    requestBody: { timeMin: startIso, timeMax: endIso, items: [{ id: 'primary' }] },
  });
  const busy = res.data.calendars?.primary?.busy || [];
  return busy.length === 0;
}

export async function createCalendarEvent(
  cfg: CalendarConfig,
  summary: string,
  description: string,
  startIso: string,
  endIso: string,
  timezone = 'America/Asuncion'
): Promise<string> {
  const auth = await getAuthorizedClient(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
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
  cfg: CalendarConfig,
  eventId: string,
  newStartIso: string,
  newEndIso: string,
  timezone = 'America/Asuncion'
): Promise<void> {
  const auth = await getAuthorizedClient(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
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

export async function cancelCalendarEvent(cfg: CalendarConfig, eventId: string): Promise<void> {
  const auth = await getAuthorizedClient(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
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
export async function listUpcomingEvents(cfg: CalendarConfig, timeMinIso: string, timeMaxIso: string): Promise<UpcomingEvent[]> {
  const auth = await getAuthorizedClient(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
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
