/**
 * Bloco 2.A.4 — migra os dados reais que hoje vivem como arquivos JSON soltos
 * no bucket "app-data" do Supabase Storage (conversas, base de conhecimento,
 * escalonamentos, respostas rápidas, status do agente, agendamentos,
 * lembretes já enviados, token do Google Calendar) pras tabelas Postgres
 * novas (supabase/migrations/0001_multi_tenant_schema.sql), todas sob o
 * tenant legado da Monique (LEGACY_DEFAULT_TENANT_ID).
 *
 * Rode UMA VEZ, depois de aplicar a migration SQL, com as env vars reais de
 * produção:
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/migrate-legacy-data.ts
 *
 * Idempotente: usa upsert em tudo, seguro rodar de novo (não duplica).
 * Se algum JSON não existir mais no Storage (bucket vazio, já limpo etc.),
 * o script pula esse item sem erro — não é obrigatório ter os 8 arquivos.
 */
import { createClient } from '@supabase/supabase-js';

const LEGACY_DEFAULT_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const BUCKET = 'app-data';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY no ambiente antes de rodar este script.');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: supabaseKey!, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function migrateConversations() {
  type OldMessage = { id: string; sender: 'lead' | 'agent'; type: string; text?: string; timestamp: string };
  type OldConversation = { phone: string; name?: string; messages: OldMessage[]; updatedAt: string; geoRestriction?: unknown };
  const data = await fetchJson<OldConversation[]>('conversations.json');
  if (!data?.length) return console.log('— conversations.json: nada a migrar.');

  for (const conv of data) {
    const { data: row, error } = await db
      .from('conversations')
      .upsert(
        { tenant_id: LEGACY_DEFAULT_TENANT_ID, phone: conv.phone, name: conv.name || null, geo_restriction: conv.geoRestriction || null, updated_at: conv.updatedAt },
        { onConflict: 'tenant_id,phone' }
      )
      .select('id')
      .single();
    if (error || !row) {
      console.warn(`  ⚠️  falha ao migrar conversa ${conv.phone}:`, error?.message);
      continue;
    }
    for (const msg of conv.messages) {
      await db.from('messages').upsert(
        { id: msg.id, tenant_id: LEGACY_DEFAULT_TENANT_ID, conversation_id: row.id, sender: msg.sender, type: msg.type, text: msg.text ?? null, created_at: msg.timestamp },
        { onConflict: 'id' }
      );
    }
  }
  console.log(`✅ conversations.json: ${data.length} conversa(s) migrada(s).`);
}

async function migrateKnowledgeBase() {
  const data = await fetchJson<Record<string, unknown>>('knowledge-base.json');
  if (!data) return console.log('— knowledge-base.json: nada a migrar.');
  await db.from('knowledge_base').upsert({ tenant_id: LEGACY_DEFAULT_TENANT_ID, data }, { onConflict: 'tenant_id' });
  console.log('✅ knowledge-base.json migrado.');
}

async function migrateEscalations() {
  type OldEscalation = { id: string; phone: string; contactName?: string; reason: string; lastMessage?: string; country: string; resolved: boolean; createdAt: string };
  const data = await fetchJson<OldEscalation[]>('escalations.json');
  if (!data?.length) return console.log('— escalations.json: nada a migrar.');
  for (const e of data) {
    await db.from('escalations').upsert(
      { id: e.id, tenant_id: LEGACY_DEFAULT_TENANT_ID, phone: e.phone, contact_name: e.contactName || null, reason: e.reason, last_message: e.lastMessage || null, country: e.country, resolved: e.resolved, created_at: e.createdAt },
      { onConflict: 'id' }
    );
  }
  console.log(`✅ escalations.json: ${data.length} escalonamento(s) migrado(s).`);
}

async function migrateQuickReplies() {
  const data = await fetchJson<string[]>('quick-replies.json');
  if (!data) return console.log('— quick-replies.json: nada a migrar.');
  await db.from('quick_replies').upsert({ tenant_id: LEGACY_DEFAULT_TENANT_ID, list: data }, { onConflict: 'tenant_id' });
  console.log('✅ quick-replies.json migrado.');
}

async function migrateAgentStatus() {
  const data = await fetchJson<{ status?: string }>('agent-status.json');
  if (!data?.status) return console.log('— agent-status.json: nada a migrar.');
  await db.from('agent_status').upsert({ tenant_id: LEGACY_DEFAULT_TENANT_ID, status: data.status }, { onConflict: 'tenant_id' });
  console.log('✅ agent-status.json migrado.');
}

async function migrateAppointments() {
  type OldAppointment = { eventId: string; summary: string; startIso: string; endIso: string; createdAt: string };
  const data = await fetchJson<Record<string, OldAppointment>>('appointments.json');
  if (!data || !Object.keys(data).length) return console.log('— appointments.json: nada a migrar.');
  for (const [phone, appt] of Object.entries(data)) {
    await db.from('appointments').upsert(
      { tenant_id: LEGACY_DEFAULT_TENANT_ID, phone, event_id: appt.eventId, summary: appt.summary, start_iso: appt.startIso, end_iso: appt.endIso, created_at: appt.createdAt },
      { onConflict: 'tenant_id,phone' }
    );
  }
  console.log(`✅ appointments.json: ${Object.keys(data).length} agendamento(s) migrado(s).`);
}

async function migrateSentReminders() {
  const data = await fetchJson<string[]>('sent-reminders.json');
  if (!data?.length) return console.log('— sent-reminders.json: nada a migrar.');
  for (const key of data) {
    const [eventId, reminderType] = key.split(':');
    if (!eventId || !reminderType) continue;
    await db.from('sent_reminders').upsert(
      { tenant_id: LEGACY_DEFAULT_TENANT_ID, event_id: eventId, reminder_type: reminderType },
      { onConflict: 'tenant_id,event_id,reminder_type' }
    );
  }
  console.log(`✅ sent-reminders.json: ${data.length} registro(s) migrado(s).`);
}

async function migrateGoogleCalendarToken() {
  const data = await fetchJson<{ refreshToken?: string }>('google-calendar-token.json');
  if (!data?.refreshToken) return console.log('— google-calendar-token.json: nada a migrar (ou já reconectado direto na tabela nova).');
  await db.from('tenant_calendar_tokens').upsert({ tenant_id: LEGACY_DEFAULT_TENANT_ID, refresh_token: data.refreshToken }, { onConflict: 'tenant_id' });
  console.log('✅ google-calendar-token.json migrado.');
}

async function main() {
  console.log(`Migrando dados legados pro tenant ${LEGACY_DEFAULT_TENANT_ID}...\n`);
  await migrateConversations();
  await migrateKnowledgeBase();
  await migrateEscalations();
  await migrateQuickReplies();
  await migrateAgentStatus();
  await migrateAppointments();
  await migrateSentReminders();
  await migrateGoogleCalendarToken();
  console.log('\n✅ Migração concluída.');
}

main().catch((err) => {
  console.error('❌ Migração falhou:', err);
  process.exit(1);
});
