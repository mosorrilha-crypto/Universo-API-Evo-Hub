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
import jwt from 'jsonwebtoken';
import { getDb } from './db';
import { getTenantBusinessHours, type BusinessHours } from './tenantProfileStore';

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
 * Storage.
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

/**
 * Bloco 2.C — o parâmetro `state` do OAuth carrega o tenantId de quem clicou
 * "Conectar", assinado (JWT curto, 10min) pra não dar pra forjar e roubar a
 * conexão de calendário de outro tenant. O callback (público, sem Bearer)
 * decodifica esse state pra saber a quem devolver o refresh token.
 */
export function signOAuthState(tenantId: string, jwtSecret: string): string {
  return jwt.sign({ tenantId }, jwtSecret, { expiresIn: '10m' });
}

/** Retorna o tenantId do state, ou null se ausente/inválido/expirado. */
export function verifyOAuthState(state: string | undefined, jwtSecret: string): string | null {
  if (!state) return null;
  try {
    const payload = jwt.verify(state, jwtSecret) as { tenantId?: string };
    return payload.tenantId || null;
  } catch {
    return null;
  }
}

/** URL de consentimento — o operador clica num link que leva aqui. */
export function getGoogleAuthUrl(clientId: string, clientSecret: string, redirectUri: string, state?: string): string {
  const client = createOAuthClient(clientId, clientSecret, redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline', // necessário pra ganhar um refresh_token
    prompt: 'consent', // força reconsentimento, garantindo que o refresh_token venha mesmo em reconexões
    scope: SCOPES,
    ...(state ? { state } : {}),
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

/** Todos os tenants com um Google Calendar conectado agora — usado pelo job de lembretes (Bloco 2.C) pra iterar por tenant em vez de rodar uma vez só globalmente. */
export async function listConnectedCalendarTenants(): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db.from('tenant_calendar_tokens').select('tenant_id');
  if (error) throw error;
  return (data || []).map((row) => row.tenant_id as string);
}

export async function disconnectGoogleCalendar(tenantId: string): Promise<void> {
  const db = getDb();
  await db.from('tenant_calendar_tokens').delete().eq('tenant_id', tenantId);
}

/**
 * Cliente OAuth autenticado, pronto pra chamar a Calendar API — renova o
 * access token sozinho a partir do refresh token.
 *
 * Achado real em produção (19/08/2026, tenant Monique): o Google às vezes
 * rotaciona o refresh_token numa renovação de access token — emite um
 * refresh_token NOVO junto com o access_token, e o antigo para de funcionar.
 * Sem escutar o evento `tokens` da lib `googleapis` e persistir esse valor
 * novo, toda chamada seguinte recriava o client com o refresh_token antigo
 * (já invalidado) direto do banco — explicava um padrão real observado:
 * funcionava uma vez logo após reconectar no painel, e voltava a falhar com
 * `invalid_grant` minutos depois, repetidamente.
 */
async function getAuthorizedClient(tenantId: string, clientId?: string, clientSecret?: string, redirectUri?: string): Promise<OAuth2Client> {
  const refreshToken = await loadRefreshToken(tenantId);
  if (!refreshToken) {
    throw new Error('Google Calendar não está conectado. Conecte no painel antes de agendar.');
  }
  const client = createOAuthClient(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      saveRefreshToken(tenantId, tokens.refresh_token).catch((err) =>
        console.warn(`⚠️  [GoogleCalendar] Falha ao persistir refresh_token rotacionado (tenant=${tenantId}):`, (err as Error).message)
      );
    }
  });
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

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * true se [startIso, endIso) (hora LOCAL naive, mesmo formato usado no
 * resto deste arquivo) cabe inteiro dentro do expediente do tenant nesse
 * dia da semana. `hours` null (tenant nunca configurou horário) nunca
 * restringe — preserva o comportamento anterior a esse recurso.
 *
 * Achado numa auditoria comparativa (07/08/2026) contra o projeto antigo da
 * Monique: sem essa checagem, nada impedia o agente de criar um
 * agendamento fora do horário de atendimento, contanto que o Google
 * Calendar mostrasse aquele horário como livre.
 */
export function isWithinBusinessHours(hours: BusinessHours | null, startIso: string, endIso: string): boolean {
  if (!hours) return true;
  const datePart = startIso.slice(0, 10);
  if (endIso.slice(0, 10) !== datePart) return false; // sessão nunca deveria cruzar meia-noite
  const weekday = new Date(`${datePart}T12:00:00Z`).getUTCDay();
  const dayHours = hours[String(weekday)];
  if (!dayHours) return false; // dia ausente do mapa = tenant não atende
  const startMinutes = timeToMinutes(startIso.slice(11, 16));
  const endMinutes = timeToMinutes(endIso.slice(11, 16));
  return startMinutes >= timeToMinutes(dayHours.open) && endMinutes <= timeToMinutes(dayHours.close);
}

/** Lança se o intervalo cair fora do expediente configurado do tenant — defesa em profundidade pras ferramentas que criam/remarcam de verdade (checkFreeBusy só informa, nunca bloqueia sozinho a criação). */
async function assertWithinBusinessHours(tenantId: string, startIso: string, endIso: string): Promise<void> {
  const hours = await getTenantBusinessHours(tenantId);
  if (!isWithinBusinessHours(hours, startIso, endIso)) {
    throw new Error('HORARIO_FORA_DO_EXPEDIENTE: esse horário cai fora do horário de atendimento configurado para esse dia.');
  }
}

/** Verifica se um intervalo está livre na agenda primária. startIso/endIso: hora local (sem offset) no fuso `timezone`. Fora do expediente do tenant conta como indisponível, sem precisar consultar o Google. */
export async function checkFreeBusy(tenantId: string, cfg: CalendarConfig, startIso: string, endIso: string, timezone = 'America/Asuncion'): Promise<boolean> {
  const hours = await getTenantBusinessHours(tenantId);
  if (!isWithinBusinessHours(hours, startIso, endIso)) return false;

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

export interface WeeklyAvailabilitySlot {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface WeeklyAvailabilityDay {
  date: string; // "YYYY-MM-DD"
  slots: WeeklyAvailabilitySlot[];
}

/**
 * Disponibilidade real dos próximos 7 dias (hoje + 6), respeitando o
 * horário de atendimento configurado do tenant e a agenda real do Google
 * Calendar — pra Etapa 6 (seção 22 do script: "essa semana só tenho sexta
 * às 9h" precisa ser verdade, não estimativa).
 *
 * Sem horário configurado (`getTenantBusinessHours` retorna null), NUNCA
 * inventa um expediente padrão — devolve lista vazia. Diferente de
 * isWithinBusinessHours (que só VALIDA um horário específico que o cliente
 * já pediu, e por isso pode ser permissivo quando não há configuração),
 * aqui estamos SUGERINDO horários proativamente — chutar "08:00-18:00" pra
 * um negócio que talvez nem funcione nesse horário seria inventar dado de
 * negócio não configurado.
 *
 * Faz UMA chamada de freebusy.query pro range da semana inteira (em vez de
 * uma por slot candidato) — o Google devolve os intervalos ocupados dentro
 * do range pedido, e a interseção com cada slot candidato é calculada
 * localmente. Evita estourar rate limit do Google numa semana com muitos
 * horários candidatos (granularidade de 30min).
 */
export async function findWeeklyAvailability(
  tenantId: string,
  cfg: CalendarConfig,
  durationMinutes: number,
  timezone = 'America/Asuncion'
): Promise<WeeklyAvailabilityDay[]> {
  const hours = await getTenantBusinessHours(tenantId);
  if (!hours) return [];

  type Candidate = { startMin: number; endMin: number };
  const candidatesByDate = new Map<string, Candidate[]>();
  const SLOT_STEP_MINUTES = 30;
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
    const dayHours = hours[String(weekday)];
    if (!dayHours) continue; // tenant não atende nesse dia

    const openMin = timeToMinutes(dayHours.open);
    const closeMin = timeToMinutes(dayHours.close);
    const dayCandidates: Candidate[] = [];
    for (let start = openMin; start + durationMinutes <= closeMin; start += SLOT_STEP_MINUTES) {
      dayCandidates.push({ startMin: start, endMin: start + durationMinutes });
    }
    if (dayCandidates.length > 0) candidatesByDate.set(dateStr, dayCandidates);
  }
  if (candidatesByDate.size === 0) return [];

  const dates = Array.from(candidatesByDate.keys());
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const auth = await getAuthorizedClient(tenantId, cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const calendar = google.calendar({ version: 'v3', auth });
  const timeMin = localNaiveToUtcIso(`${firstDate}T00:00:00`, timezone);
  const timeMax = localNaiveToUtcIso(`${lastDate}T23:59:59`, timezone);
  const res = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] },
  });
  const busy = (res.data.calendars?.primary?.busy || [])
    .filter((b) => b.start && b.end)
    .map((b) => ({ startMs: new Date(b.start!).getTime(), endMs: new Date(b.end!).getTime() }));

  const result: WeeklyAvailabilityDay[] = [];
  for (const [date, candidates] of candidatesByDate) {
    const freeSlots: WeeklyAvailabilitySlot[] = [];
    for (const c of candidates) {
      const slotStartMs = new Date(localNaiveToUtcIso(`${date}T${minutesToTime(c.startMin)}:00`, timezone)).getTime();
      const slotEndMs = new Date(localNaiveToUtcIso(`${date}T${minutesToTime(c.endMin)}:00`, timezone)).getTime();
      const isFree = !busy.some((b) => slotStartMs < b.endMs && b.startMs < slotEndMs);
      if (isFree) freeSlots.push({ start: minutesToTime(c.startMin), end: minutesToTime(c.endMin) });
    }
    if (freeSlots.length > 0) result.push({ date, slots: freeSlots });
  }
  return result;
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
  await assertWithinBusinessHours(tenantId, startIso, endIso);
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
  await assertWithinBusinessHours(tenantId, newStartIso, newEndIso);
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
