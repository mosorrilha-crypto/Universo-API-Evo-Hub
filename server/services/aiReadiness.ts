import { isGenerating } from './generatingLock';
import { getDb } from './db';
import { getConversation } from './conversationStore';
import { getRuntimeKnowledgeBase } from './knowledgeBaseStore';
import { resolveCredentialsForConversation, type SharedEvolutionCredentials, type SharedMetaCredentials } from './tenantResolver';
import { isOperatorActivelyEngaged } from './operatorEngagement';
import { isAgentStatusPaused } from './agentStatus';

export interface AiReadiness {
  state: 'ready' | 'busy' | 'blocked' | 'conditional' | 'unknown';
  reason: 'ready' | 'generating' | 'agent_paused' | 'restricted_hours' | 'contact_blocked' | 'operator_active' | 'operator_started'
    | 'ads_only' | 'leads_only' | 'ai_unavailable' | 'knowledge_unavailable' | 'channel_disconnected'
    | 'channel_unverified' | 'receive_unverified' | 'last_reply_failed' | 'unavailable';
  checkedAt: string;
  validUntil: string;
}

/** Só leitura: não marca lead de anúncio, não gera resposta e não envia mensagem. */
export async function getAiReadiness(tenantId: string, phone: string, deps: {
  aiConfigured: boolean; lastSendStatus?: string | null; lastDecisionAt?: string; sharedMeta: SharedMetaCredentials; sharedEvo: SharedEvolutionCredentials;
}): Promise<AiReadiness> {
  const now = Date.now();
  const result = (state: AiReadiness['state'], reason: AiReadiness['reason']): AiReadiness => ({
    state, reason, checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 45000).toISOString(),
  });
  try {
    const db = getDb();
    const [{ data: settings, error }, conversation] = await Promise.all([
      db.from('agent_status').select('status, ads_only, leads_only').eq('tenant_id', tenantId).maybeSingle(),
      getConversation(tenantId, phone),
    ]);
    if (error || !conversation) return result('unknown', 'unavailable');
    const status = settings?.status || 'active';
    if (!['active', 'paused', 'restricted'].includes(status)) return result('unknown', 'unavailable');
    if (isAgentStatusPaused(status)) return result('blocked', status === 'paused' ? 'agent_paused' : 'restricted_hours');
    if (conversation.aiBlockedAt) return result('blocked', 'contact_blocked');
    const first = conversation.messages[0];
    if (first?.sender === 'agent' && first.sentBy === 'operator' && !conversation.adGreetingMatchedAt) return result('blocked', 'operator_started');
    if (isOperatorActivelyEngaged(conversation)) return result('blocked', 'operator_active');
    if (isGenerating(tenantId, phone)) return result('busy', 'generating');
    if (deps.lastDecisionAt && Date.parse(deps.lastDecisionAt) >= now - 15 * 60000
      && ['send_failed', 'not_sent_blocked', 'not_sent_calendar_error'].includes(deps.lastSendStatus || '')) {
      return result('unknown', 'last_reply_failed');
    }
    if (!deps.aiConfigured) return result('blocked', 'ai_unavailable');
    const kb = await getRuntimeKnowledgeBase(tenantId);
    if (!kb.knowledgeBase) return result('blocked', 'knowledge_unavailable');
    const { data: attribution, error: attributionError } = await db.from('conversations').select('id, ctwa_clid')
      .eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
    if (attributionError) return result('unknown', 'unavailable');
    if (settings?.ads_only && !attribution?.ctwa_clid && !conversation.adGreetingMatchedAt) return result('conditional', 'ads_only');
    if (settings?.leads_only) return result('conditional', 'leads_only');
    const channel = await resolveCredentialsForConversation(tenantId, conversation.phoneNumberId, deps.sharedMeta, deps.sharedEvo);
    if (channel.provider === 'evolution') {
      if (!channel.evolutionApiUrl || !channel.evolutionApiKey || !channel.evolutionInstanceName) return result('unknown', 'channel_unverified');
      const url = new URL(channel.evolutionApiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return result('unknown', 'channel_unverified');
      const response = await fetch(`${url.href.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(channel.evolutionInstanceName)}`, {
        headers: { apikey: channel.evolutionApiKey }, signal: AbortSignal.timeout(3000), redirect: 'error',
      });
      if (!response.ok) return result('unknown', 'channel_unverified');
      const data = await response.json();
      const state = data?.instance?.state;
      if (!['open', 'close', 'connecting'].includes(state)) return result('unknown', 'channel_unverified');
      if (state !== 'open') return result('blocked', 'channel_disconnected');
    } else if (!channel.metaAccessToken || !channel.metaPhoneNumberId) {
      return result('unknown', 'channel_unverified');
    }
    // Socket aberto não comprova recepção (incidente Monique). Exige evidência recente
    // do canal, sem enviar uma mensagem de teste. Histórico antigo não renova esta prova.
    const { data: incoming, error: incomingError } = await db.from('messages').select('created_at')
      .eq('tenant_id', tenantId).eq('conversation_id', attribution?.id).eq('sender', 'lead').gte('created_at', new Date(now - 15 * 60000).toISOString())
      .order('created_at', { ascending: false }).limit(1);
    if (incomingError) return result('unknown', 'unavailable');
    const recent = incoming?.some(row => {
      const time = Date.parse(row.created_at);
      return time <= now && time >= now - 15 * 60000;
    });
    if (!recent) return result('unknown', 'receive_unverified');
    return result('ready', 'ready');
  } catch {
    return result('unknown', 'unavailable');
  }
}
