export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  htmlLink?: string;
  status?: string;
  creator?: {
    email?: string;
    displayName?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string; // ISO string e.g. 2026-08-05T15:00:00-04:00
  endDateTime: string;   // ISO string e.g. 2026-08-05T17:00:00-04:00
  timeZone?: string;
  attendeesEmails?: string[];
  clientName?: string;
  clientPhone?: string;
  serviceName?: string;
  depositStatus?: string;
}

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

// List user's calendars
export async function listUserCalendars(accessToken: string): Promise<CalendarListEntry[]> {
  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erro ao carregar calendários (${res.status})`);
  }

  const data = await res.json();
  return data.items || [];
}

// Fetch upcoming events from a calendar
export async function listCalendarEvents(
  accessToken: string,
  calendarId = 'primary',
  maxResults = 50,
  timeMin?: string
): Promise<GoogleCalendarEvent[]> {
  const minTime = timeMin || new Date().toISOString();
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', minTime);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', maxResults.toString());

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erro ao carregar agendamentos do Google Calendar (${res.status})`);
  }

  const data = await res.json();
  return data.items || [];
}

// Create a new event in Google Calendar
export async function createCalendarEvent(
  accessToken: string,
  input: CreateEventInput,
  calendarId = 'primary'
): Promise<GoogleCalendarEvent> {
  const timeZone = input.timeZone || 'America/Asuncion';

  const body: any = {
    summary: input.summary,
    description: input.description || '',
    location: input.location || 'Monique Sorrilha Beauty Studio - Calle Paso Bogarín 3665, Loma Merlo, Luque',
    start: {
      dateTime: input.startDateTime,
      timeZone: timeZone,
    },
    end: {
      dateTime: input.endDateTime,
      timeZone: timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 1440 }, // 24 hours before
      ],
    },
  };

  if (input.attendeesEmails && input.attendeesEmails.length > 0) {
    body.attendees = input.attendeesEmails.map((email) => ({ email }));
  }

  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erro ao criar evento no Google Calendar (${res.status})`);
  }

  return await res.json();
}

// Delete an event from Google Calendar (requires explicit confirmation in UI)
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId = 'primary'
): Promise<boolean> {
  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 204) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erro ao cancelar agendamento no Google Calendar (${res.status})`);
  }

  return true;
}

// Update an existing Google Calendar event
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  input: CreateEventInput,
  calendarId = 'primary'
): Promise<GoogleCalendarEvent> {
  const timeZone = input.timeZone || 'America/Asuncion';

  const body: any = {
    summary: input.summary,
    description: input.description || '',
    location: input.location || 'Monique Sorrilha Beauty Studio - Calle Paso Bogarín 3665, Loma Merlo, Luque',
    start: {
      dateTime: input.startDateTime,
      timeZone: timeZone,
    },
    end: {
      dateTime: input.endDateTime,
      timeZone: timeZone,
    },
  };

  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erro ao atualizar evento no Google Calendar (${res.status})`);
  }

  return await res.json();
}
