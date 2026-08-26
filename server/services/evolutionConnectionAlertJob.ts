/**
 * Job periódico — fecha um buraco de observabilidade achado numa investigação
 * real (24/08/2026, tenant Monique — Lucas Gimenes): a sessão Baileys/
 * Evolution de um tenant pode cair silenciosamente. O WhatsApp continua
 * entregando mensagem ponta-a-ponta entre os dois números normalmente nesse
 * meio tempo (não depende da nossa conexão com a Evolution API) — mas o
 * webhook pra nosso backend para de chegar, tanto a mensagem do lead quanto o
 * eco do que o operador manda direto do celular (`fromMe: true`, ver
 * server/routes/webhooks.ts). O sintoma real é "cliente manda mensagem, IA
 * nunca responde, ninguém vê erro nenhum" — só dava pra descobrir abrindo
 * Configurações e reparando no botão "Reconectar WhatsApp". Nunca reconecta
 * sozinho, só avisa (mesmo padrão de agentPausedAlertJob.ts/
 * systemErrorAlertService.ts).
 *
 * Detecta a queda com a mesma chamada do endpoint GET
 * .../evolution-instance/status (admin.ts): `GET
 * /instance/connectionState/:instance` na própria Evolution API. Só alerta
 * depois de ficar fora de "open" por mais de `disconnectedThresholdMs`
 * (evita alertar em cada blip de rede curto — a 1ª detecção só marca o
 * início do episódio) e só uma vez por episódio de queda
 * (disconnected_alert_sent_at comparado com disconnected_since, mesmo
 * padrão de paused_alert_sent_at em agentPausedAlertJob.ts) — reconectar
 * limpa os dois marcadores, permitindo alertar de novo numa queda futura.
 */
import { getDb, getPlatformDb } from './db';
import { runWithTenantDbContext } from './tenantDbContext';
import { sendWhatsAppTemplateMessage } from './metaSend';
import { resolveMetaCredentialsForTenant } from './tenantResolver';
import { sendPushToTenant } from './webPush';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DISCONNECTED_THRESHOLD_MS = 5 * 60 * 1000;
const CONNECTION_STATE_TIMEOUT_MS = 15000;

/** Template aprovado no Meta Business Manager (categoria Utilitário) — corpo sugerido: "⚠️ WhatsApp de {{1}} desconectado há {{2}}min. Mensagens de clientes podem não estar chegando — reconecte em Configurações." — {{1}} nome do tenant, {{2}} minutos desconectado, nessa ordem. */
const TEMPLATE_NAME = 'whatsapp_desconectado_alerta';
const TEMPLATE_LANGUAGE = 'pt_BR';

interface EvolutionCredentialRow {
  tenant_id: string;
  instance_name: string;
  api_url: string;
  api_key: string;
  last_connection_state: string | null;
  disconnected_since: string | null;
  disconnected_alert_sent_at: string | null;
}

async function fetchConnectionState(apiUrl: string, apiKey: string, instanceName: string): Promise<string> {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/instance/connectionState/${instanceName}`, {
    headers: { apikey: apiKey },
    signal: AbortSignal.timeout(CONNECTION_STATE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  // Formato varia por versão do servidor Evolution, mesma cautela do endpoint .../evolution-instance/status em admin.ts.
  return data?.instance?.state || data?.state || 'unknown';
}

async function updateCredentialRow(
  tenantId: string,
  patch: Partial<Pick<EvolutionCredentialRow, 'last_connection_state' | 'disconnected_since' | 'disconnected_alert_sent_at'>>
): Promise<void> {
  const db = getDb();
  const { error } = await db.from('tenant_evolution_credentials').update(patch).eq('tenant_id', tenantId);
  if (error) throw error;
}

export interface EvolutionConnectionAlertJobDeps {
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  intervalMs?: number;
  disconnectedThresholdMs?: number;
}

async function checkOneTenant(row: EvolutionCredentialRow, deps: EvolutionConnectionAlertJobDeps): Promise<void> {
  const thresholdMs = deps.disconnectedThresholdMs ?? DEFAULT_DISCONNECTED_THRESHOLD_MS;
  let state: string;
  try {
    state = await fetchConnectionState(row.api_url, row.api_key, row.instance_name);
  } catch (err) {
    console.warn(`⚠️  [Alerta conexão WhatsApp] tenant=${row.tenant_id} falha ao consultar estado da instância "${row.instance_name}":`, (err as Error).message);
    return; // falha transitória de rede pra consultar o status — não conta como "desconectado", tenta de novo no próximo tick
  }

  if (state === 'open') {
    // Reconectou (ou nunca esteve desconectado) — limpa qualquer episódio de queda em aberto pra poder alertar de novo numa queda futura.
    if (row.last_connection_state !== 'open' || row.disconnected_since || row.disconnected_alert_sent_at) {
      if (row.disconnected_since) {
        console.log(`✅ [Alerta conexão WhatsApp] tenant=${row.tenant_id} reconectado (instância "${row.instance_name}").`);
      }
      await updateCredentialRow(row.tenant_id, { last_connection_state: 'open', disconnected_since: null, disconnected_alert_sent_at: null });
    }
    return;
  }

  const now = Date.now();
  if (!row.disconnected_since) {
    // 1ª detecção desse episódio — só marca o início, ainda não alerta (dá chance de um blip curto se resolver sozinho antes do threshold).
    await updateCredentialRow(row.tenant_id, { last_connection_state: state, disconnected_since: new Date(now).toISOString() });
    return;
  }

  const disconnectedSinceMs = new Date(row.disconnected_since).getTime();
  if (now - disconnectedSinceMs < thresholdMs) return;
  if (row.disconnected_alert_sent_at && new Date(row.disconnected_alert_sent_at).getTime() >= disconnectedSinceMs) return; // já alertou por ESSE episódio

  const db = getDb();
  const { data: tenant } = await db.from('tenants').select('name, admin_alert_phone').eq('id', row.tenant_id).maybeSingle();
  const tenantName = tenant?.name || row.tenant_id;
  const disconnectedMinutes = Math.round((now - disconnectedSinceMs) / 60000);

  // Canal 1: push pro PWA do atendente — mesmo padrão dos outros alertas, nunca lança (sendPushToTenant engole erro de assinatura individual).
  await sendPushToTenant(row.tenant_id, {
    title: '🔌 WhatsApp desconectado',
    body: `${tenantName} — sem conexão há ${disconnectedMinutes}min. Mensagens de clientes podem não estar chegando. Reconecte em Configurações.`,
    tag: `evolution-disconnected-${row.tenant_id}`,
  });

  const adminPhone = tenant?.admin_alert_phone;
  if (!adminPhone) {
    console.warn(`⚠️  [Alerta conexão WhatsApp] tenant=${row.tenant_id} sem admin_alert_phone configurado — sem alerta via WhatsApp (push, se configurado, ainda foi tentado acima).`);
    await updateCredentialRow(row.tenant_id, { last_connection_state: state, disconnected_alert_sent_at: new Date(now).toISOString() });
    return;
  }

  try {
    const { metaAccessToken, metaPhoneNumberId } = await resolveMetaCredentialsForTenant(row.tenant_id, {
      metaAccessToken: deps.metaAccessToken,
      metaPhoneNumberId: deps.metaPhoneNumberId,
    });
    await sendWhatsAppTemplateMessage(metaPhoneNumberId, metaAccessToken, adminPhone, TEMPLATE_NAME, TEMPLATE_LANGUAGE, [tenantName, String(disconnectedMinutes)]);
    console.log(`🔔 [Alerta conexão WhatsApp] tenant=${row.tenant_id} avisou ${adminPhone} — desconectado há ${disconnectedMinutes}min.`);
  } catch (err) {
    console.warn(`⚠️  [Alerta conexão WhatsApp] tenant=${row.tenant_id} falha ao mandar WhatsApp:`, (err as Error).message);
  }
  await updateCredentialRow(row.tenant_id, { last_connection_state: state, disconnected_alert_sent_at: new Date(now).toISOString() });
}

/** Uma passada do job — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkEvolutionConnectionsAndAlert(deps: EvolutionConnectionAlertJobDeps = {}): Promise<void> {
  const db = getPlatformDb();
  const { data, error } = await db
    .from('tenant_evolution_credentials')
    .select('tenant_id, instance_name, api_url, api_key, last_connection_state, disconnected_since, disconnected_alert_sent_at');
  if (error) {
    console.warn('⚠️  [Alerta conexão WhatsApp] Falha ao listar instâncias Evolution:', (error as Error).message);
    return;
  }
  const rows = (data as EvolutionCredentialRow[]) || [];
  for (const row of rows) {
    try {
      await runWithTenantDbContext({ tenantId: row.tenant_id, source: 'job' }, () => checkOneTenant(row, deps));
    } catch (err) {
      console.warn(`⚠️  [Alerta conexão WhatsApp] tenant=${row.tenant_id} falha ao processar:`, (err as Error).message);
    }
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 5 min) — mesmo padrão de startAgentPausedAlertJob. */
export function startEvolutionConnectionAlertJob(deps: EvolutionConnectionAlertJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = () => checkEvolutionConnectionsAndAlert(deps).catch((err) => console.warn('⚠️  [Alerta conexão WhatsApp] Erro no job:', err.message));
  run();
  setInterval(run, intervalMs);
}
