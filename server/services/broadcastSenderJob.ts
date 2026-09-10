/**
 * Job de envio do disparo em massa (broadcast/marketing) — TASK-0171.
 * Mesmo idioma de `agentPausedAlertJob.ts` + `periodicJob.ts`: descobre
 * quais tenants têm campanha `running` via `getPlatformDb()`, entra no
 * contexto RLS de cada um (`runWithTenantDbContext`) e processa cada par
 * (campanha, número) respeitando a cota do NÚMERO (não da campanha — vários
 * números da mesma campanha têm cotas independentes, e o mesmo número pode
 * ser usado por mais de uma campanha ao mesmo tempo, com a cota somada
 * entre elas).
 *
 * Freios de segurança, em ordem: qualidade/status do número > cota de
 * 60s/24h (aquecimento adaptativo incluso) > lote máximo por tick. Nenhum
 * desses é pulado mesmo sob pressão de fila grande — é exatamente o
 * contrário do que se quer aqui (ver plano da feature, seção de
 * aquecimento).
 */
import { startPeriodicJob } from './periodicJob';
import { runWithTenantDbContext } from './tenantDbContext';
import { sendWhatsAppTemplateMessage } from './metaSend';
import { sendEvolutionTextMessage } from './evolutionSend';
import { resolveCredentialsForConversation } from './tenantResolver';
import { getOrCreateConversationForBroadcast, recordOutgoingMessage } from './conversationStore';
import { effectiveDailyCap, hasCompletedWarmup } from './warmupCurve';
import { isWithinSendWindow } from './sendWindow';
import {
  listRunningCampaignsAcrossTenants,
  listScheduledCampaignsDueToStart,
  transitionCampaignToRunning,
  listCampaignNumbersWithDetails,
  listCampaignTemplatesWithDetails,
  getCampaign,
  getBroadcastTemplate,
  getBroadcastContactsByIds,
  countRecipientsSentSince,
  dequeuePendingRecipients,
  markRecipientSending,
  markRecipientSent,
  markRecipientFailed,
  markCampaignCompletedIfDone,
  updateBroadcastNumberWarmupProgress,
  renderTemplateDisplayText,
  type BroadcastNumber,
  type BroadcastCampaign,
  type CampaignTemplateWithDetails,
} from './broadcastStore';

// TASK-0206 — achado real (01/09/2026): este job rodava a cada 20s O TEMPO
// TODO, mesmo em tenants que nunca criaram uma única campanha de disparo —
// só pra confirmar "não tem nada pra fazer" a cada tick. Contribuiu pro
// projeto Supabase estourar a cota de egress do Free Plan (31GB usados vs
// 5GB incluídos) mesmo com uso real baixíssimo. Nada aqui é sensível a
// segundos (a janela de envio, cota por minuto/dia e curva de aquecimento
// já toleram folga de sobra) — as rotas de criar/ativar campanha
// (broadcast.ts) agora chamam `runBroadcastSenderTick` na hora, então este
// intervalo vira só a rede de segurança (cobre campanhas agendadas pra uma
// hora futura, sem precisar de um job de agendamento à parte), mesmo
// padrão do safetyPoll de 90s em WhatsAppLeadsSim.tsx pro SSE.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** Lote máximo processado por combinação (campanha, número) a cada tick — evita um tick único demorado demais mesmo com fila grande e cota alta. */
const MAX_BATCH_PER_TICK = 20;
/**
 * TASK-0367 — teto adicional só pra números Evolution, bem mais baixo que o
 * da Meta: pedido direto ("o menor lote possível primeiro e espaçamento
 * maior"), já que a Evolution/Baileys não tem quota oficial nem curva de
 * qualidade calibrada pela própria Meta pra confiar — o número operacional
 * de verdade do tenant está em jogo, não um número de disparo descartável.
 * Aplica mesmo que `per_minute_cap`/`daily_cap` do número estejam
 * configurados mais permissivos.
 */
const EVOLUTION_MAX_BATCH_PER_TICK = 2;

export interface BroadcastSenderJobDeps {
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  intervalMs?: number;
}

/** Dia corrido em UTC — deliberado, não bug (ver plano: a curva de aquecimento já é uma margem de segurança conservadora, não um limite exato da Meta). */
function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Avança o progresso de aquecimento no máximo 1x por dia corrido, e só se a
 * qualidade estiver Alta/Média naquele dia — dias de qualidade ruim/nunca
 * conferida (`low`/`unknown`) NÃO avançam o contador, ele fica congelado no
 * patamar atual em vez de subir só por ter passado tempo (ver
 * warmupCurve.ts). Promove sozinho pra `active` quando o patamar da curva já
 * alcança o teto configurado.
 */
async function maybeAdvanceWarmup(tenantId: string, number: BroadcastNumber): Promise<BroadcastNumber> {
  if (number.status !== 'warming') return number;
  const today = todayUtcIso();
  if (number.warmupLastAdvancedOn === today) return number;
  if (number.qualityRating !== 'high' && number.qualityRating !== 'medium') return number;

  const nextProgress = number.warmupProgressDays + 1;
  const completed = hasCompletedWarmup(nextProgress, number.dailyCap);
  await updateBroadcastNumberWarmupProgress(tenantId, number.id, {
    warmupProgressDays: nextProgress,
    warmupLastAdvancedOn: today,
    status: completed ? 'active' : 'warming',
  });
  return { ...number, warmupProgressDays: nextProgress, warmupLastAdvancedOn: today, status: completed ? 'active' : number.status };
}

async function processCampaignNumber(
  tenantId: string,
  campaignId: string,
  numberInput: BroadcastNumber,
  campaign: BroadcastCampaign,
  deps: BroadcastSenderJobDeps
): Promise<void> {
  // Freio de segurança acima de qualquer cota — qualidade ruim ou
  // pausado/banido manualmente pula o número neste tick, sem tentar sequer
  // calcular cota. Reconfirmado de novo depois do aquecimento (pode ter
  // mudado por outra via entre a checagem e o avanço).
  if (numberInput.status === 'banned' || numberInput.status === 'paused' || numberInput.qualityRating === 'low') return;

  const number = await maybeAdvanceWarmup(tenantId, numberInput);
  if (number.status === 'banned' || number.status === 'paused') return;

  const oneMinuteAgoIso = new Date(Date.now() - 60_000).toISOString();
  const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [sentLastMinute, sentLastDay] = await Promise.all([
    countRecipientsSentSince(number.id, oneMinuteAgoIso),
    countRecipientsSentSince(number.id, oneDayAgoIso),
  ]);

  const effectiveCap = number.status === 'warming' ? effectiveDailyCap(number.warmupProgressDays, number.dailyCap) : number.dailyCap;
  const remainingMinute = number.perMinuteCap - sentLastMinute;
  const remainingDay = effectiveCap - sentLastDay;
  const maxBatchPerTick = number.provider === 'evolution' ? EVOLUTION_MAX_BATCH_PER_TICK : MAX_BATCH_PER_TICK;
  const quota = Math.max(0, Math.min(remainingMinute, remainingDay, maxBatchPerTick));
  if (quota <= 0) return;

  const recipients = await dequeuePendingRecipients(campaignId, number.id, quota);
  if (!recipients.length) return;

  // Uma campanha pode ter mais de um template vinculado (variação de
  // texto/formato) — cada `recipient.templateId` já diz qual usar,
  // atribuído no round-robin da criação da campanha. `recipient.templateId`
  // nulo só acontece em recipients de campanhas criadas antes dessa
  // feature existir — cai pro `campaign.templateId` de sempre.
  const templateLinks = await listCampaignTemplatesWithDetails(tenantId, campaignId);
  const templatesById = new Map<string, CampaignTemplateWithDetails>(templateLinks.map((link) => [link.templateId, link]));
  // Campanhas criadas antes de broadcast_campaign_templates existir não têm
  // nenhum link — cai pro template único de sempre (campaign.templateId).
  if (!templatesById.size) {
    const legacyTemplate = await getBroadcastTemplate(tenantId, campaign.templateId);
    if (!legacyTemplate) {
      console.warn(`⚠️  [Disparo] campanha=${campaignId} template=${campaign.templateId} não encontrado — pulando este tick.`);
      return;
    }
    templatesById.set(campaign.templateId, { id: '', templateId: campaign.templateId, headerMediaId: campaign.headerMediaId, template: legacyTemplate });
  }

  const contactsById = await getBroadcastContactsByIds(tenantId, recipients.map((r) => r.contactId));

  for (const recipient of recipients) {
    await markRecipientSending(recipient.id);
    const templateLink = templatesById.get(recipient.templateId || campaign.templateId);
    if (!templateLink) {
      await markRecipientFailed(recipient.id, `Template ${recipient.templateId || campaign.templateId} não encontrado ou não vinculado à campanha.`);
      continue;
    }
    const template = templateLink.template;
    const headerMediaId = templateLink.headerMediaId || (templateLink.templateId === campaign.templateId ? campaign.headerMediaId : null);
    const contact = contactsById.get(recipient.contactId);
    const variables = contact?.variables || {};
    try {
      const displayText = renderTemplateDisplayText(template.bodyText, variables) || template.name;
      let messageId: string | undefined;
      let conversation: { id: string; phoneNumberId: string | null };

      if (number.provider === 'evolution') {
        // TASK-0367 — Evolution não tem "número de disparo" separado do
        // operacional (Baileys só conecta UM número por instância): a
        // conversa fica sem phone_number_id próprio (null), pra sair pelo
        // mesmo caminho de sempre (resolveCredentialsForConversation cai no
        // operacional real do tenant quando não há phone_number_id
        // dedicado — mesmo comportamento de uma conversa comum).
        conversation = await getOrCreateConversationForBroadcast(tenantId, recipient.phone, contact?.name ?? null, null);
        const credentials = await resolveCredentialsForConversation(
          tenantId,
          conversation.phoneNumberId,
          { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId },
          { evolutionApiUrl: deps.evolutionApiUrl, evolutionApiKey: deps.evolutionApiKey, evolutionInstanceName: deps.evolutionInstanceName }
        );
        if (credentials.provider !== 'evolution' || !credentials.evolutionInstanceName) {
          throw new Error('Número marcado como Evolution, mas o tenant não tem credencial Evolution configurada (tenant_evolution_credentials).');
        }
        messageId = await sendEvolutionTextMessage(credentials.evolutionInstanceName, credentials.evolutionApiUrl, credentials.evolutionApiKey, recipient.phone, displayText);
      } else {
        // Busca-ou-cria a conversa: se já existir (contato conhecido que
        // passou pelo toggle "incluir mesmo assim"), NUNCA sobrescreve o
        // phone_number_id dela — usa o que ela já tinha. Protege contra a
        // colisão de roteamento mesmo no caso raro de a conversa ter sido
        // criada por outra via entre a alocação da campanha e o envio real.
        conversation = await getOrCreateConversationForBroadcast(tenantId, recipient.phone, contact?.name ?? null, number.phoneNumberId);
        const credentials = await resolveCredentialsForConversation(
          tenantId,
          conversation.phoneNumberId,
          { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId },
          { evolutionApiUrl: deps.evolutionApiUrl, evolutionApiKey: deps.evolutionApiKey, evolutionInstanceName: deps.evolutionInstanceName }
        );

        const bodyParams = template.bodyVariableLabels.map((label) => variables[label] ?? '');
        const sent = await sendWhatsAppTemplateMessage(
          credentials.metaPhoneNumberId,
          credentials.metaAccessToken,
          recipient.phone,
          template.name,
          template.language,
          bodyParams,
          undefined,
          headerMediaId || undefined
        );
        messageId = sent.messageId;
      }

      await recordOutgoingMessage(
        tenantId,
        recipient.phone,
        { type: 'text', text: displayText, timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
        'campaign'
      );
      await markRecipientSent(recipient.id, messageId, conversation.id);
    } catch (err) {
      await markRecipientFailed(recipient.id, (err as Error)?.message || String(err));
    }

    if (number.minGapSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, number.minGapSeconds * 1000));
    }
  }

  await markCampaignCompletedIfDone(tenantId, campaignId);
}

async function processCampaign(tenantId: string, campaignId: string, deps: BroadcastSenderJobDeps): Promise<void> {
  const campaign = await getCampaign(tenantId, campaignId);
  if (!campaign) return;
  // Janela de horário comercial da campanha — fora dela, nenhum número
  // envia neste tick (a fila continua pending, sem gastar cota nenhuma).
  // start/end nulos = sem restrição (comportamento de antes desta janela
  // existir, preservado pra qualquer campanha já criada).
  if (!isWithinSendWindow(new Date(), campaign.sendWindowStart, campaign.sendWindowEnd, campaign.sendWindowTimezone)) return;

  const numbersWithDetails = await listCampaignNumbersWithDetails(tenantId, campaignId);
  for (const { number } of numbersWithDetails) {
    try {
      await processCampaignNumber(tenantId, campaignId, number, campaign, deps);
    } catch (err) {
      console.warn(`⚠️  [Disparo] tenant=${tenantId} campanha=${campaignId} número=${number.id} falhou neste tick:`, (err as Error)?.message || err);
    }
  }
}

/**
 * Promove sozinho campanhas `scheduled` cuja hora marcada já chegou —
 * sem isso, `scheduledAt` era só um campo decorativo (TASK-0173: o
 * agendamento nunca disparava nada de verdade). Usa `transitionCampaignToRunning`
 * (não `updateCampaignStatus` puro) pra também cobrir o upload de header de
 * imagem na 1ª execução, mesmo caminho que a rota PATCH usa quando um humano
 * inicia manualmente.
 */
async function promoteDueScheduledCampaigns(): Promise<void> {
  let due: Array<{ tenantId: string; campaignId: string }>;
  try {
    due = await listScheduledCampaignsDueToStart();
  } catch (err) {
    console.warn('⚠️  [Disparo] Falha ao listar campanhas agendadas:', (err as Error)?.message || err);
    return;
  }

  for (const { tenantId, campaignId } of due) {
    try {
      await runWithTenantDbContext({ tenantId, source: 'job' }, () => transitionCampaignToRunning(tenantId, campaignId));
    } catch (err) {
      console.warn(`⚠️  [Disparo] tenant=${tenantId} campanha=${campaignId} falhou ao promover agendamento:`, (err as Error)?.message || err);
    }
  }
}

/** Uma passada do job — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function runBroadcastSenderTick(deps: BroadcastSenderJobDeps = {}): Promise<void> {
  await promoteDueScheduledCampaigns();

  let running: Array<{ tenantId: string; campaignId: string }>;
  try {
    running = await listRunningCampaignsAcrossTenants();
  } catch (err) {
    console.warn('⚠️  [Disparo] Falha ao listar campanhas em execução:', (err as Error)?.message || err);
    return;
  }

  for (const { tenantId, campaignId } of running) {
    try {
      await runWithTenantDbContext({ tenantId, source: 'job' }, () => processCampaign(tenantId, campaignId, deps));
    } catch (err) {
      console.warn(`⚠️  [Disparo] tenant=${tenantId} campanha=${campaignId} falhou:`, (err as Error)?.message || err);
    }
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 5min, TASK-0206 — rede de segurança, não o gatilho principal) — mesmo padrão de startAgentPausedAlertJob/startReminderJob. */
export function startBroadcastSenderJob(deps: BroadcastSenderJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'disparo-em-massa-sender',
    intervalMs,
    () => runBroadcastSenderTick(deps),
    (err) => console.warn('⚠️  [Disparo] Erro no job:', err instanceof Error ? err.message : String(err))
  );
}
