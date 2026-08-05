/**
 * Rastreia o agendamento ATIVO (evento do Google Calendar) de cada número de
 * telefone — necessário pra remarcar/cancelar sem depender do modelo
 * "lembrar" ou inventar um eventId: o agente de agendamento nunca recebe o
 * eventId como parâmetro, o código sempre resolve o evento certo a partir
 * do telefone de quem está conversando.
 */
export interface TrackedAppointment {
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
  createdAt: string;
}

const BUCKET = 'app-data';
const OBJECT_PATH = 'appointments.json';

const appointments = new Map<string, TrackedAppointment>();
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function initAppointmentPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, TrackedAppointment>;
      for (const [phone, appt] of Object.entries(data)) appointments.set(phone, appt);
      console.log(`💾 [Agendamentos] ${appointments.size} restaurado(s) do Supabase Storage.`);
    }
  } catch (err) {
    console.warn('⚠️  [Agendamentos] Falha ao carregar:', (err as Error).message);
  }
}

function scheduleSave() {
  if (!persistence) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(`${persistence!.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
        method: 'POST',
        headers: {
          apikey: persistence!.supabaseKey,
          Authorization: `Bearer ${persistence!.supabaseKey}`,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(Object.fromEntries(appointments)),
      });
    } catch (err) {
      console.warn('⚠️  [Agendamentos] Falha ao salvar:', (err as Error).message);
    }
  }, 2000);
}

export function getAppointmentForPhone(phone: string): TrackedAppointment | undefined {
  return appointments.get(phone);
}

export function setAppointmentForPhone(phone: string, appt: Omit<TrackedAppointment, 'createdAt'>) {
  appointments.set(phone, { ...appt, createdAt: new Date().toISOString() });
  scheduleSave();
}

export function clearAppointmentForPhone(phone: string) {
  appointments.delete(phone);
  scheduleSave();
}

/** Todos os agendamentos ativos — usado pelo job de lembretes automáticos pra saber a quem enviar. */
export function listAllAppointments(): Array<{ phone: string } & TrackedAppointment> {
  return Array.from(appointments.entries()).map(([phone, appt]) => ({ phone, ...appt }));
}
