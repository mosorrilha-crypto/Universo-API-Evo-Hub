/**
 * Controle de status do agente automático (3 estados): "active" (responde
 * sempre), "paused" (silêncio total, operador assume manualmente),
 * "restricted" (só responde fora do horário comercial). Migrado pra tabela
 * Postgres `agent_status` (Bloco 2.A), 1 registro por tenant_id.
 */
import { getDb } from './db';

export type AgentStatus = 'active' | 'paused' | 'restricted';

const TIMEZONE = 'America/Asuncion';

export async function getAgentStatus(tenantId: string): Promise<AgentStatus> {
  const db = getDb();
  const { data } = await db.from('agent_status').select('status').eq('tenant_id', tenantId).maybeSingle();
  return (data?.status as AgentStatus | undefined) || 'active';
}

export async function setAgentStatus(tenantId: string, status: AgentStatus): Promise<void> {
  if (!['active', 'paused', 'restricted'].includes(status)) {
    throw new Error(`Status inválido: ${status}`);
  }
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .upsert({ tenant_id: tenantId, status, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** true = não deve responder automaticamente agora. */
export async function isAgentPaused(tenantId: string): Promise<boolean> {
  const status = await getAgentStatus(tenantId);
  if (status === 'paused') return true;
  if (status === 'restricted') {
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: TIMEZONE, hour: '2-digit', hour12: false }));
    return hour >= 8 && hour < 20; // silêncio 08:00–19:59, só responde à noite/madrugada
  }
  return false;
}

/**
 * Modo "somente anúncios" (pedido real, 14/08/2026): quando o tenant tem
 * mais de um número de WhatsApp ligado (ex: o pessoal do dono do negócio,
 * conectado temporariamente pra não perder mensagem, e o número dedicado
 * do agente), ativar isso faz o agente só responder automaticamente
 * contatos identificados como vindos de anúncio — nunca contatos pessoais.
 * Flag ortogonal ao status active/paused/restricted, não um 4º valor dele;
 * quem chama combina isso com o ctwa_clid e os gatilhos de texto da
 * conversa (ver shouldBlockForAdsOnlyMode em conversationStore.ts, usado
 * por webhooks.ts e transcriptionQueue.ts). A mensagem em si continua
 * sendo gravada normalmente — só a resposta automática fica em silêncio.
 */
export async function isAdsOnlyMode(tenantId: string): Promise<boolean> {
  const db = getDb();
  const { data } = await db.from('agent_status').select('ads_only').eq('tenant_id', tenantId).maybeSingle();
  return !!data?.ads_only;
}

export async function setAdsOnlyMode(tenantId: string, adsOnly: boolean): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .upsert({ tenant_id: tenantId, ads_only: adsOnly, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/**
 * Achado real em produção (15/08/2026): o ctwa_clid quase nunca vem
 * preenchido no tráfego real de anúncio (a Meta nem sempre manda o
 * referral), o que deixava o modo "somente anúncios" bloqueando lead
 * nenhum de anúncio de verdade. Complemento: o tenant cadastra o(s) texto(s)
 * exato(s) do "ice breaker" que a Meta oferece no botão do anúncio (ex: "Me
 * gustaría reservar un horario para el combo de cejas y labios 💕") — a
 * primeira mensagem de um lead que bate com um desses gatilhos é tratada
 * como vinda de anúncio mesmo sem ctwa_clid (ver
 * shouldBlockForAdsOnlyMode/markAdGreetingMatched em conversationStore.ts).
 */
export async function getAdTriggerMessages(tenantId: string): Promise<string[]> {
  const db = getDb();
  const { data } = await db.from('agent_status').select('ad_trigger_messages').eq('tenant_id', tenantId).maybeSingle();
  return Array.isArray(data?.ad_trigger_messages) ? data.ad_trigger_messages : [];
}

export async function setAdTriggerMessages(tenantId: string, messages: string[]): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('agent_status')
    .upsert({ tenant_id: tenantId, ad_trigger_messages: messages, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** Normaliza (apara espaços, colapsa espaço interno, minúsculas) pra comparar sem exigir bater byte a byte — emoji e acentos não são afetados. */
function normalizeForAdTriggerMatch(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * true se `text` bate (depois de normalizado) com algum dos gatilhos
 * configurados. Compara por PREFIXO (não substring solto) de propósito: os
 * "ice breakers" da Meta são um texto pronto que entra pré-preenchido na
 * caixa de digitação do lead — um match solto (substring em qualquer
 * posição) abriria brecha pra mensagem orgânica de cliente real (ex:
 * "quería reservar un horario") disparar resposta indevidamente fora do
 * modo somente-anúncios. Prefixo é o meio-termo certo: continua exigindo o
 * texto INTEIRO do gatilho, só não trava mais quando o lead emenda algo
 * depois sem espaço.
 *
 * Achado real em produção (15/08/2026): comparação exata (antes deste
 * fix) travava com "hola" emendado direto depois do gatilho sem espaço
 * (ex: "...cejas y labios 💕hola") — comportamento comum de verdade (o
 * lead toca o botão de ice breaker da Meta, que pré-preenche o texto, e
 * digita algo a mais antes de mandar). Sem bater o gatilho, a mensagem
 * ficava travada em silêncio pelo modo somente-anúncios — sem log, sem
 * escalonamento, sem nada visível pro operador.
 */
export function matchesAdTriggerMessage(text: string, triggers: string[]): boolean {
  const normalizedText = normalizeForAdTriggerMatch(text);
  if (!normalizedText) return false;
  return triggers.some((trigger) => {
    const normalizedTrigger = normalizeForAdTriggerMatch(trigger);
    return !!normalizedTrigger && normalizedText.startsWith(normalizedTrigger);
  });
}
