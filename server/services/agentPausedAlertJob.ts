/**
 * Job periódico (issue #115) — alerta o operador quando o agente automático
 * fica pausado tempo demais COM mensagem de lead sem resposta acumulando.
 * Pausa sozinha não é erro (pode ser proposital — operador assumiu
 * manualmente), mas antes disso não gerava nenhum aviso: só dava pra
 * descobrir olhando o banco direto (achado real em produção em 09/08/2026 —
 * agente ficou paused ~4h, 8 mensagens de 6 leads diferentes sem resposta,
 * zero alerta). Nunca reativa o agente sozinho, só avisa.
 *
 * Idempotente por "sessão de pausa": setAgentStatus (agentStatus.ts) sempre
 * atualiza updated_at, mesmo reafirmando o mesmo status — comparar
 * paused_alert_sent_at com updated_at detecta se já alertou pra ESSA pausa
 * específica, sem duplicar a cada tick do job nem deixar de alertar de novo
 * se pausar → reativar → pausar de novo.
 *
 * Canal 2 (WhatsApp) via adminAlertChannel.ts (issue #290, seção 1) — antes
 * chamava resolveMetaCredentialsForTenant só com a credencial Meta recebida
 * por deps, nunca tentava Evolution API pro tenant que atende de verdade
 * por lá.
 */
import { getDb } from './db';
import { sendAdminAlert } from './adminAlertChannel';
import { sendPushToTenant } from './webPush';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
/** Sugestão da issue #115 — tempo pausado antes de considerar "alguém precisa saber". */
const DEFAULT_PAUSE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Template aprovado no Meta Business Manager (categoria Utilitário) —
 * necessário porque o admin normalmente não tem conversa ativa recente com o
 * número comercial, então mensagem de texto livre falharia fora da janela de
 * 24h. Corpo: "⚠️ O agente de {{1}} está pausado há {{2}}min com lead sem
 * resposta (ex: {{3}})." — {{1}} nome do tenant, {{2}} minutos pausado, {{3}}
 * nome/telefone do lead sem resposta, nessa ordem.
 */
const TEMPLATE_NAME = 'agente_pausado_alerta';
const TEMPLATE_LANGUAGE = 'pt_BR';

interface AgentStatusRow {
  tenant_id: string;
  updated_at: string;
  paused_alert_sent_at: string | null;
}

async function listStalePausedTenants(thresholdMs: number): Promise<AgentStatusRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from('agent_status')
    .select('tenant_id, updated_at, paused_alert_sent_at')
    .eq('status', 'paused');
  if (error) throw error;
  const now = Date.now();
  return ((data as AgentStatusRow[]) || []).filter((row) => {
    const pausedSinceMs = new Date(row.updated_at).getTime();
    if (now - pausedSinceMs < thresholdMs) return false;
    if (row.paused_alert_sent_at && new Date(row.paused_alert_sent_at).getTime() >= pausedSinceMs) return false;
    return true;
  });
}

interface MessageAfterPauseRow {
  conversation_id: string;
  sender: 'lead' | 'agent';
  created_at: string;
}

/**
 * Acha uma conversa cuja mensagem mais recente desde `sinceIso` (início da
 * pausa atual) é do lead — ou seja, ninguém (IA nem operador) respondeu
 * depois disso. Consulta a tabela `messages` direto em vez de reusar
 * conversationStore.listConversations: essa usa embed relacional do
 * Supabase (`messages(...)` dentro do select de `conversations`), que o
 * fake de teste (fakeSupabase.ts) não simula — aqui fica só com
 * eq/gte/in, que o fake cobre de verdade.
 */
async function findUnansweredLeadSince(tenantId: string, sinceIso: string): Promise<{ phone: string; name?: string } | null> {
  const db = getDb();
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', sinceIso);
  if (error) throw error;

  const lastByConversation = new Map<string, MessageAfterPauseRow>();
  for (const row of (data as MessageAfterPauseRow[]) || []) {
    const current = lastByConversation.get(row.conversation_id);
    if (!current || row.created_at > current.created_at) lastByConversation.set(row.conversation_id, row);
  }

  const staleConversationIds = [...lastByConversation.entries()]
    .filter(([, row]) => row.sender === 'lead')
    .map(([conversationId]) => conversationId);
  if (!staleConversationIds.length) return null;

  const { data: convRows, error: convError } = await db
    .from('conversations')
    .select('phone, name')
    .eq('tenant_id', tenantId)
    .in('id', staleConversationIds);
  if (convError) throw convError;
  const conv = (convRows as { phone: string; name: string | null }[] | null)?.[0];
  return conv ? { phone: conv.phone, name: conv.name || undefined } : null;
}

async function markAlertSent(tenantId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .update({ paused_alert_sent_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

export interface AgentPausedAlertJobDeps {
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  intervalMs?: number;
  pauseThresholdMs?: number;
}

async function alertForTenant(row: AgentStatusRow, deps: AgentPausedAlertJobDeps): Promise<void> {
  const unanswered = await findUnansweredLeadSince(row.tenant_id, row.updated_at);
  if (!unanswered) return;

  const db = getDb();
  const { data: tenant } = await db
    .from('tenants')
    .select('name, admin_alert_phone')
    .eq('id', row.tenant_id)
    .maybeSingle();

  const pausedMinutes = Math.round((Date.now() - new Date(row.updated_at).getTime()) / 60000);
  const tenantName = tenant?.name || row.tenant_id;
  const leadLabel = unanswered.name || unanswered.phone;

  // Canal 1: push pro PWA do atendente (issue #159) — independente do
  // admin_alert_phone abaixo, por dispositivo/operador que autorizou
  // notificação. Nunca lança (sendPushToTenant engole erro por assinatura).
  await sendPushToTenant(row.tenant_id, {
    title: '⚠️ Agente pausado com lead sem resposta',
    body: `${tenantName} — pausado há ${pausedMinutes}min, ex: ${leadLabel}`,
    tag: `agent-paused-${row.tenant_id}`,
  });

  // Canal 2: WhatsApp template pro admin_alert_phone (canal original).
  const adminPhone = tenant?.admin_alert_phone;
  if (!adminPhone) {
    console.warn(`⚠️  [Alerta agente pausado] tenant=${row.tenant_id} sem admin_alert_phone configurado — sem alerta via WhatsApp (push, se configurado, ainda foi tentado acima).`);
    return;
  }

  await sendAdminAlert(
    row.tenant_id,
    adminPhone,
    {
      templateName: TEMPLATE_NAME,
      templateLanguage: TEMPLATE_LANGUAGE,
      templateArgs: [tenantName, String(pausedMinutes), leadLabel],
      freeText: `⚠️ O agente de ${tenantName} está pausado há ${pausedMinutes}min com lead sem resposta (ex: ${leadLabel}).`,
    },
    {
      metaAccessToken: deps.metaAccessToken,
      metaPhoneNumberId: deps.metaPhoneNumberId,
      evolutionApiUrl: deps.evolutionApiUrl,
      evolutionApiKey: deps.evolutionApiKey,
      evolutionInstanceName: deps.evolutionInstanceName,
    }
  );
  await markAlertSent(row.tenant_id);
  console.log(`🔔 [Alerta agente pausado] tenant=${row.tenant_id} avisou ${adminPhone} (pausado há ${pausedMinutes}min).`);
}

/** Uma passada do job — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkPausedAgentsAndAlert(deps: AgentPausedAlertJobDeps = {}): Promise<void> {
  const thresholdMs = deps.pauseThresholdMs ?? DEFAULT_PAUSE_THRESHOLD_MS;
  let stale: AgentStatusRow[];
  try {
    stale = await listStalePausedTenants(thresholdMs);
  } catch (err) {
    console.warn('⚠️  [Alerta agente pausado] Falha ao listar tenants pausados:', (err as Error).message);
    return;
  }

  for (const row of stale) {
    try {
      await alertForTenant(row, deps);
    } catch (err) {
      console.warn(`⚠️  [Alerta agente pausado] tenant=${row.tenant_id} falha ao processar:`, (err as Error).message);
    }
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startReminderJob/startPreReservationFollowUpJob. */
export function startAgentPausedAlertJob(deps: AgentPausedAlertJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = () => checkPausedAgentsAndAlert(deps).catch((err) => console.warn('⚠️  [Alerta agente pausado] Erro no job:', err.message));
  run();
  setInterval(run, intervalMs);
}
