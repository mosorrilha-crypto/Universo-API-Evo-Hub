/**
 * Disparo em massa (broadcast/marketing) via WhatsApp — TASK-0171. Painel
 * só de `saas_admin`, escopado por tenant via `resolveTenantId(req)` (usa
 * o `X-Tenant-Id` que o painel já manda quando saas_admin troca de tenant —
 * nenhuma rota aceita tenantId do body/query, mesma regra do resto do
 * sistema). Ver `docs/task-registry/TASK-0171.md` pro raciocínio completo.
 */
import { Router, type RequestHandler } from 'express';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import { resolveTenantId } from '../middleware/rbac';
import { getDb } from '../services/db';
import { uploadWhatsAppMedia, sendWhatsAppTemplateMessage } from '../services/metaSend';
import {
  listBroadcastNumbers,
  createBroadcastNumber,
  updateBroadcastNumber,
  deleteBroadcastNumber,
  getBroadcastNumber,
  type BroadcastNumberStatus,
  type BroadcastQualityRating,
  listBroadcastTemplates,
  createBroadcastTemplate,
  updateBroadcastTemplate,
  deleteBroadcastTemplate,
  getBroadcastTemplate,
  type BroadcastTemplateCategory,
  type BroadcastTemplateHeaderType,
  importContactList,
  createContactListFromSegment,
  type ContactListSegment,
  listContactLists,
  getContactListContacts,
  getContactList,
  deleteContactList,
  previewCampaignAllocation,
  createCampaign,
  listCampaigns,
  getCampaign,
  listCampaignNumberAllocations,
  listCampaignTemplateLinks,
  getCampaignCounts,
  listCampaignRecipients,
  updateCampaignStatus,
  updateCampaignSchedule,
  transitionCampaignToRunning,
  type BroadcastCampaignStatus,
  type BroadcastRecipientStatus,
} from '../services/broadcastStore';
import { isValidTimeOfDay } from '../services/sendWindow';

interface BroadcastRouterDeps {
  authenticateToken: RequestHandler;
  /**
   * TASK-0206 — chamado (melhor esforço, nunca aguardado pela resposta HTTP)
   * depois de criar ou ativar/agendar uma campanha, pra processar na hora
   * em vez de esperar o próximo tick do job de fundo (que virou uma rede de
   * segurança de 5min, não mais o gatilho principal — ver
   * broadcastSenderJob.ts). Opcional só pra não quebrar testes que montam
   * o router sem essa dependência.
   */
  triggerImmediateBroadcastTick?: () => void;
}

const NUMBER_STATUSES: BroadcastNumberStatus[] = ['active', 'paused', 'banned', 'warming'];
const QUALITY_RATINGS: BroadcastQualityRating[] = ['unknown', 'high', 'medium', 'low'];
const TEMPLATE_CATEGORIES: BroadcastTemplateCategory[] = ['marketing', 'utility'];
const TEMPLATE_HEADER_TYPES: BroadcastTemplateHeaderType[] = ['none', 'image'];
const RECIPIENT_STATUSES: BroadcastRecipientStatus[] = [
  'pending', 'sending', 'sent', 'delivered', 'failed', 'skipped_existing_contact', 'skipped_recent_duplicate',
];
/** Mesmo teto (~6MB reais de imagem) de MAX_IMAGE_BASE64_LENGTH em roadmap.ts:21. */
const MAX_HEADER_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;

function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

function stripDataUriPrefix(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, '');
}

/** Nunca devolve o token de acesso em texto puro — só um booleano, mesmo padrão de GerenciarCredenciaisCapi (admin.ts). */
function serializeNumber(number: Awaited<ReturnType<typeof getBroadcastNumber>>) {
  if (!number) return null;
  const { accessToken, ...rest } = number;
  return { ...rest, tokenSet: !!accessToken };
}

export function createBroadcastRouter({ authenticateToken, triggerImmediateBroadcastTick }: BroadcastRouterDeps): Router {
  const router = Router();
  const requireSaasAdmin = requireRole('saas_admin');

  // ── Números ──────────────────────────────────────────────────────────
  router.get('/api/admin/broadcast-numbers', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const numbers = await listBroadcastNumbers(tenantOf(req));
    res.json({ numbers: numbers.map(serializeNumber) });
  }));

  router.post('/api/admin/broadcast-numbers', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { label, phoneNumberId, wabaId, accessToken, perMinuteCap, dailyCap, minGapSeconds } = req.body || {};
    if (typeof label !== 'string' || !label.trim()) return res.status(400).json({ error: 'Campo "label" é obrigatório.' });
    if (typeof phoneNumberId !== 'string' || !phoneNumberId.trim()) return res.status(400).json({ error: 'Campo "phoneNumberId" é obrigatório.' });
    const number = await createBroadcastNumber(tenantOf(req), {
      label: label.trim(),
      phoneNumberId: phoneNumberId.trim(),
      wabaId: wabaId || null,
      accessToken: accessToken || null,
      perMinuteCap,
      dailyCap,
      minGapSeconds,
    });
    res.status(201).json({ number: serializeNumber(number) });
  }));

  router.patch('/api/admin/broadcast-numbers/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { label, wabaId, accessToken, status, qualityRating, perMinuteCap, dailyCap, minGapSeconds } = req.body || {};
    if (status !== undefined && !NUMBER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Campo "status" precisa ser um de: ${NUMBER_STATUSES.join(', ')}.` });
    }
    if (qualityRating !== undefined && !QUALITY_RATINGS.includes(qualityRating)) {
      return res.status(400).json({ error: `Campo "qualityRating" precisa ser um de: ${QUALITY_RATINGS.join(', ')}.` });
    }
    const number = await updateBroadcastNumber(tenantOf(req), req.params.id, {
      label, wabaId, accessToken, status, qualityRating, perMinuteCap, dailyCap, minGapSeconds,
    });
    if (!number) return res.status(404).json({ error: 'Número não encontrado.' });
    res.json({ number: serializeNumber(number) });
  }));

  router.delete('/api/admin/broadcast-numbers/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteBroadcastNumber(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  // ── Templates ────────────────────────────────────────────────────────
  router.get('/api/admin/broadcast-templates', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const templates = await listBroadcastTemplates(tenantOf(req));
    res.json({ templates });
  }));

  router.post('/api/admin/broadcast-templates', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, language, category, headerType, bodyVariableLabels, bodyText, headerImageBase64, footerText } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
    if (typeof language !== 'string' || !language.trim()) return res.status(400).json({ error: 'Campo "language" é obrigatório.' });
    if (category !== undefined && !TEMPLATE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Campo "category" precisa ser um de: ${TEMPLATE_CATEGORIES.join(', ')}.` });
    }
    if (headerType !== undefined && !TEMPLATE_HEADER_TYPES.includes(headerType)) {
      return res.status(400).json({ error: `Campo "headerType" precisa ser um de: ${TEMPLATE_HEADER_TYPES.join(', ')}.` });
    }
    if (headerImageBase64 && headerImageBase64.length > MAX_HEADER_IMAGE_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Imagem de cabeçalho muito grande — máximo de ~6MB.' });
    }
    const template = await createBroadcastTemplate(tenantOf(req), {
      name: name.trim(),
      language: language.trim(),
      category: category || 'marketing',
      headerType: headerType || 'none',
      bodyVariableLabels: Array.isArray(bodyVariableLabels) ? bodyVariableLabels : [],
      bodyText: bodyText || '',
      headerImageBase64: headerImageBase64 || null,
      footerText: footerText || null,
    });
    res.status(201).json({ template });
  }));

  router.patch('/api/admin/broadcast-templates/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, language, category, headerType, bodyVariableLabels, bodyText, headerImageBase64, footerText } = req.body || {};
    if (category !== undefined && !TEMPLATE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Campo "category" precisa ser um de: ${TEMPLATE_CATEGORIES.join(', ')}.` });
    }
    if (headerType !== undefined && !TEMPLATE_HEADER_TYPES.includes(headerType)) {
      return res.status(400).json({ error: `Campo "headerType" precisa ser um de: ${TEMPLATE_HEADER_TYPES.join(', ')}.` });
    }
    if (headerImageBase64 && headerImageBase64.length > MAX_HEADER_IMAGE_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Imagem de cabeçalho muito grande — máximo de ~6MB.' });
    }
    const template = await updateBroadcastTemplate(tenantOf(req), req.params.id, {
      name, language, category, headerType, bodyVariableLabels, bodyText, headerImageBase64, footerText,
    });
    if (!template) return res.status(404).json({ error: 'Template não encontrado.' });
    res.json({ template });
  }));

  router.delete('/api/admin/broadcast-templates/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteBroadcastTemplate(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  // Só um teste de upload (confirma que a imagem é aceita pela Meta antes de
  // salvar) — o media_id real de disparo é sempre gerado de novo por
  // campanha, a partir do header_image_base64 já persistido no template.
  router.post('/api/admin/broadcast-templates/:id/header-image', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { imageBase64, broadcastNumberId } = req.body || {};
    if (typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Campo "imageBase64" precisa ser uma data URI de imagem.' });
    }
    if (imageBase64.length > MAX_HEADER_IMAGE_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Imagem muito grande — máximo de ~6MB.' });
    }
    const tenantId = tenantOf(req);
    const number = await getBroadcastNumber(tenantId, broadcastNumberId || '');
    if (!number) return res.status(400).json({ error: 'Selecione um número de disparo válido pra testar o upload.' });
    const mimeMatch = imageBase64.match(/^data:([^;]+);base64,/);
    const buffer = Buffer.from(stripDataUriPrefix(imageBase64), 'base64');
    const mediaId = await uploadWhatsAppMedia(number.phoneNumberId, number.accessToken || undefined, buffer, mimeMatch?.[1] || 'image/jpeg', 'header.jpg');
    res.json({ mediaId });
  }));

  // ── Listas de contatos ───────────────────────────────────────────────
  router.get('/api/admin/broadcast-contact-lists', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const lists = await listContactLists(tenantOf(req));
    res.json({ lists });
  }));

  router.post('/api/admin/broadcast-contact-lists', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, filename, csvBase64 } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
    if (typeof csvBase64 !== 'string' || !csvBase64) return res.status(400).json({ error: 'Campo "csvBase64" é obrigatório.' });
    if (csvBase64.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande — máximo de ~10MB.' });
    }
    const csvText = Buffer.from(stripDataUriPrefix(csvBase64), 'base64').toString('utf8');
    const result = await importContactList(tenantOf(req), name.trim(), filename || null, csvText, req.user?.id || null);
    res.status(201).json({ list: result.list, imported: result.imported, duplicatesIgnored: result.duplicatesIgnored });
  }));

  // Monta a lista a partir de dado real já existente no sistema (não CSV)
  // — "já é lead" (conversations) ou "já tem agendamento confirmado"
  // (appointments com eventId real). Não existe segmento de "inscrito em
  // evento": o sistema não tem essa entidade, e inventar uma fabricaria
  // dado de negócio que não existe (mesma regra do agente de IA).
  const CONTACT_LIST_SEGMENTS: ContactListSegment[] = ['known_leads', 'has_appointment'];
  router.post('/api/admin/broadcast-contact-lists/from-segment', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, segment } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
    if (!CONTACT_LIST_SEGMENTS.includes(segment)) {
      return res.status(400).json({ error: `Campo "segment" precisa ser um de: ${CONTACT_LIST_SEGMENTS.join(', ')}.` });
    }
    try {
      const result = await createContactListFromSegment(tenantOf(req), name.trim(), segment, req.user?.id || null);
      res.status(201).json({ list: result.list, imported: result.imported });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  router.get('/api/admin/broadcast-contact-lists/:id/contacts', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await getContactListContacts(tenantOf(req), req.params.id, { limit, offset });
    res.json(result);
  }));

  router.delete('/api/admin/broadcast-contact-lists/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteContactList(tenantOf(req), req.params.id);
    res.json({ success: true });
  }));

  // ── Campanhas ────────────────────────────────────────────────────────
  router.get('/api/admin/broadcast-campaigns/preview-allocation', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const contactListId = String(req.query.contactListId || '');
    const dedupeWindowDays = Number(req.query.dedupeWindowDays) || 3;
    if (!contactListId) return res.status(400).json({ error: 'Parâmetro "contactListId" é obrigatório.' });
    const preview = await previewCampaignAllocation(tenantOf(req), contactListId, dedupeWindowDays);
    res.json({ preview });
  }));

  router.get('/api/admin/broadcast-campaigns', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const campaigns = await listCampaigns(tenantOf(req));
    res.json({ campaigns });
  }));

  router.post('/api/admin/broadcast-campaigns', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const {
      name, templateId, extraTemplateIds, contactListId, dedupeWindowDays, consentConfirmed,
      numberAllocations, includeExistingContacts, includeRecentDuplicates,
    } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
    if (typeof templateId !== 'string' || !templateId) return res.status(400).json({ error: 'Campo "templateId" é obrigatório.' });
    if (extraTemplateIds !== undefined && (!Array.isArray(extraTemplateIds) || extraTemplateIds.some((t: any) => typeof t !== 'string'))) {
      return res.status(400).json({ error: 'Campo "extraTemplateIds" precisa ser uma lista de IDs de template.' });
    }
    if (typeof contactListId !== 'string' || !contactListId) return res.status(400).json({ error: 'Campo "contactListId" é obrigatório.' });
    if (!Array.isArray(numberAllocations) || !numberAllocations.length) {
      return res.status(400).json({ error: 'Selecione ao menos um número de disparo em "numberAllocations".' });
    }
    for (const alloc of numberAllocations) {
      if (!alloc?.broadcastNumberId || !(Number(alloc.count) > 0)) {
        return res.status(400).json({ error: 'Cada item de "numberAllocations" precisa de "broadcastNumberId" e "count" > 0.' });
      }
    }

    try {
      const campaign = await createCampaign(tenantOf(req), {
        name: name.trim(),
        templateId,
        extraTemplateIds: extraTemplateIds || undefined,
        contactListId,
        dedupeWindowDays: dedupeWindowDays || 3,
        consentConfirmed: !!consentConfirmed,
        numberAllocations: numberAllocations.map((a: any) => ({ broadcastNumberId: a.broadcastNumberId, count: Number(a.count) })),
        includeExistingContacts: !!includeExistingContacts,
        includeRecentDuplicates: !!includeRecentDuplicates,
        createdBy: req.user?.id || null,
      });
      // TASK-0206 — toda campanha nasce em 'draft' (broadcastStore.ts),
      // então não tem trabalho pra processar ainda; o tick é disparado só
      // quando o status muda pra 'running'/'scheduled' via PATCH abaixo.
      res.status(201).json({ campaign });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  router.get('/api/admin/broadcast-campaigns/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const campaign = await getCampaign(tenantId, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
    const [numberAllocations, templateLinks, counts] = await Promise.all([
      listCampaignNumberAllocations(tenantId, req.params.id),
      listCampaignTemplateLinks(req.params.id),
      getCampaignCounts(tenantId, req.params.id),
    ]);
    res.json({ campaign, numberAllocations, templateLinks, counts: counts.total, countsByNumber: counts.byNumber });
  }));

  router.patch('/api/admin/broadcast-campaigns/:id', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status, scheduledAt, sendWindowStart, sendWindowEnd, sendWindowTimezone } = req.body || {};
    const validStatuses: BroadcastCampaignStatus[] = ['draft', 'scheduled', 'running', 'paused', 'completed', 'canceled'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Campo "status" precisa ser um de: ${validStatuses.join(', ')}.` });
    }
    const hasScheduleFields = scheduledAt !== undefined || sendWindowStart !== undefined || sendWindowEnd !== undefined || sendWindowTimezone !== undefined;
    if (!status && !hasScheduleFields) {
      return res.status(400).json({ error: 'Informe "status" e/ou os campos de agendamento (scheduledAt/sendWindowStart/sendWindowEnd/sendWindowTimezone).' });
    }
    if (sendWindowStart !== undefined && sendWindowStart !== null && (typeof sendWindowStart !== 'string' || !isValidTimeOfDay(sendWindowStart))) {
      return res.status(400).json({ error: 'Campo "sendWindowStart" precisa estar no formato HH:MM (24h), ou null.' });
    }
    if (sendWindowEnd !== undefined && sendWindowEnd !== null && (typeof sendWindowEnd !== 'string' || !isValidTimeOfDay(sendWindowEnd))) {
      return res.status(400).json({ error: 'Campo "sendWindowEnd" precisa estar no formato HH:MM (24h), ou null.' });
    }

    const tenantId = tenantOf(req);
    try {
      // Ajusta agendamento/janela ANTES da transição de status, pra que
      // "agendar" numa única chamada (scheduledAt + status: 'scheduled')
      // já valide com o valor recém-enviado, não com o antigo.
      if (hasScheduleFields) {
        await updateCampaignSchedule(tenantId, req.params.id, { scheduledAt, sendWindowStart, sendWindowEnd, sendWindowTimezone });
      }

      const campaign = status
        ? (status === 'running' ? await transitionCampaignToRunning(tenantId, req.params.id) : await updateCampaignStatus(tenantId, req.params.id, status))
        : await getCampaign(tenantId, req.params.id);

      // TASK-0206 — só vale a pena processar na hora quando a campanha
      // pode ter trabalho pendente pra fazer agora (running) ou logo (uma
      // hora de agendamento acabou de ser confirmada); outras transições
      // (paused/canceled/completed/draft) não precisam de tick nenhum.
      if (status === 'running' || (status === 'scheduled' && hasScheduleFields)) {
        triggerImmediateBroadcastTick?.();
      }

      res.json({ campaign });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  router.get('/api/admin/broadcast-campaigns/:id/recipients', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status, broadcastNumberId, sentFrom, sentTo } = req.query;
    if (status !== undefined && !RECIPIENT_STATUSES.includes(status as BroadcastRecipientStatus)) {
      return res.status(400).json({ error: `Parâmetro "status" precisa ser um de: ${RECIPIENT_STATUSES.join(', ')}.` });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await listCampaignRecipients(tenantOf(req), req.params.id, {
      status: status as BroadcastRecipientStatus | undefined,
      broadcastNumberId: broadcastNumberId ? String(broadcastNumberId) : undefined,
      sentFrom: sentFrom ? String(sentFrom) : undefined,
      sentTo: sentTo ? String(sentTo) : undefined,
      limit,
      offset,
    });
    res.json(result);
  }));

  // Dispara o template real pro admin_alert_phone do tenant — pega erro de
  // nome/idioma/quantidade de variáveis do template ANTES do disparo real
  // pra lista inteira (ver plano da feature, "Envio de Teste").
  router.post('/api/admin/broadcast-campaigns/:id/test-send', authenticateToken, requireSaasAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const campaign = await getCampaign(tenantId, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
    const template = await getBroadcastTemplate(tenantId, campaign.templateId);
    if (!template) return res.status(404).json({ error: 'Template da campanha não encontrado.' });
    const allocations = await listCampaignNumberAllocations(tenantId, req.params.id);
    const number = await getBroadcastNumber(tenantId, allocations[0]?.broadcastNumberId || '');
    if (!number) return res.status(400).json({ error: 'Configure ao menos um número de disparo pra esta campanha antes de testar.' });

    const db = getDb();
    const { data: tenant, error: tenantError } = await db.from('tenants').select('admin_alert_phone').eq('id', tenantId).maybeSingle();
    if (tenantError) return res.status(500).json({ error: tenantError.message });
    const testPhone = tenant?.admin_alert_phone;
    if (!testPhone) return res.status(400).json({ error: 'Configure o "Telefone de alerta" deste tenant antes de enviar um teste.' });

    let headerMediaId: string | undefined;
    if (template.headerType === 'image' && template.headerImageBase64) {
      const mimeMatch = template.headerImageBase64.match(/^data:([^;]+);base64,/);
      const buffer = Buffer.from(stripDataUriPrefix(template.headerImageBase64), 'base64');
      headerMediaId = await uploadWhatsAppMedia(number.phoneNumberId, number.accessToken || undefined, buffer, mimeMatch?.[1] || 'image/jpeg', 'header-teste.jpg');
    }

    const bodyParams = template.bodyVariableLabels.map((label) => `[Exemplo: ${label}]`);
    const { messageId } = await sendWhatsAppTemplateMessage(
      number.phoneNumberId,
      number.accessToken || undefined,
      testPhone,
      template.name,
      template.language,
      bodyParams,
      undefined,
      headerMediaId
    );
    res.json({ success: true, messageId, sentTo: testPhone });
  }));

  return router;
}
