import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import { requireRole, resolveTenantId } from '../middleware/rbac';
import {
  createQualityReview,
  deriveMemoryCorrectionInsights,
  deriveQualityRecommendations,
  listQualityAuditEvents,
  listQualityReviews,
  recordQualityAuditEvent,
  updateQualityReview,
  type QualityReviewKind,
  type QualityReviewStatus,
} from '../services/qualityAuditStore';
import {
  createControlledExperiment,
  getMandatoryStopConditions,
  listControlledExperiments,
  transitionControlledExperiment,
  type ControlledExperimentStatus,
} from '../services/controlledExperimentStore';
import {
  decideMemoryPatternReview,
  listMemoryPatternReviews,
  syncMemoryPatternReviewCandidates,
  type MemoryPatternReviewStatus,
} from '../services/memoryPatternReviewStore';

interface QualityAuditRouterDeps {
  authenticateToken: RequestHandler;
}

function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

function parseKind(value: unknown): QualityReviewKind | undefined {
  return value === 'ai_suggestion' || value === 'bug' || value === 'operator_idea' || value === 'knowledge' ? value : undefined;
}

function parseStatus(value: unknown): QualityReviewStatus | undefined {
  return value === 'pending' || value === 'approved' || value === 'testing' || value === 'published' || value === 'rejected' || value === 'resolved' || value === 'reopened' ? value : undefined;
}

function safeContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function createQualityAuditRouter({ authenticateToken }: QualityAuditRouterDeps): Router {
  const router = Router();

  router.get('/api/quality-audit', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const kind = parseKind(req.query.kind);
    const status = parseStatus(req.query.status);
    const tenantId = tenantOf(req);
    const [reviews, events, memoryPatternReviews, controlledExperiments] = await Promise.all([
      listQualityReviews(tenantId, { kind, status }),
      listQualityAuditEvents(tenantId),
      listMemoryPatternReviews(tenantId),
      listControlledExperiments(tenantId),
    ]);
    const pendingCount = reviews.filter((item) => item.status === 'pending').length;
    const correctedCount = reviews.filter((item) => item.context?.decision === 'corrected').length;
    const rejectedCount = reviews.filter((item) => item.context?.decision === 'rejected' || item.status === 'rejected').length;
    const lowConfidenceCount = reviews.filter((item) => typeof item.confidence === 'number' && item.confidence < 0.7).length;
    res.json({
      reviews,
      events,
      recommendations: deriveQualityRecommendations(reviews),
      memoryCorrectionInsights: deriveMemoryCorrectionInsights(events),
      memoryPatternReviews,
      controlledExperiments,
      mandatoryExperimentStopConditions: getMandatoryStopConditions(),
      metrics: {
        totalReviews: reviews.length,
        pendingCount,
        correctedCount,
        rejectedCount,
        lowConfidenceCount,
        totalEvents: events.length,
      },
    });
  }));

  /**
   * Cria somente o desenho administrativo do experimento. O objeto resultante
   * não é lido pelo autoReply nem altera prompt, agenda, pagamento ou canal.
   */
  router.post('/api/quality-audit/controlled-experiments', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const qualityReviewId = req.body?.qualityReviewId;
    const testingReview = typeof qualityReviewId === 'string'
      ? (await listQualityReviews(tenantId, { status: 'testing' })).find((review) => review.id === qualityReviewId)
      : null;
    if (!testingReview) return res.status(400).json({ error: 'Selecione um item de Qualidade existente e em teste.' });

    const experiment = await createControlledExperiment({
      tenantId,
      qualityReviewId: testingReview.id,
      hypothesis: req.body?.hypothesis,
      variationSummary: req.body?.variationSummary,
      scopeRoutes: req.body?.scopeRoutes,
      sampleLimit: req.body?.sampleLimit,
      successCriteria: req.body?.successCriteria,
      stopConditions: req.body?.stopConditions,
      createdBy: req.user?.id || null,
    });
    await recordQualityAuditEvent({
      tenantId,
      eventType: 'controlled_experiment_created',
      source: 'quality_admin',
      entityType: 'controlled_quality_experiment',
      entityId: experiment.id,
      actorId: req.user?.id,
      payload: {
        qualityReviewId: experiment.quality_review_id,
        scopeRoutes: experiment.scope_routes,
        sampleLimit: experiment.sample_limit,
        successCriteriaCount: experiment.success_criteria.length,
        stopConditionsCount: experiment.stop_conditions.length,
      },
    });
    res.status(201).json({ experiment });
  }));

  router.patch('/api/quality-audit/controlled-experiments/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const requestedStatus = req.body?.status;
    const allowedStatuses: ControlledExperimentStatus[] = ['ready', 'running', 'paused', 'completed', 'rejected'];
    if (!allowedStatuses.includes(requestedStatus)) return res.status(400).json({ error: 'Transição de experimento inválida.' });
    const tenantId = tenantOf(req);
    const experiment = await transitionControlledExperiment({
      tenantId,
      experimentId: req.params.id,
      status: requestedStatus,
      decisionNote: req.body?.decisionNote,
      outcomeSummary: req.body?.outcomeSummary,
      actorId: req.user?.id || null,
    });
    if (!experiment) return res.status(404).json({ error: 'Experimento não encontrado.' });
    await recordQualityAuditEvent({
      tenantId,
      eventType: 'controlled_experiment_transitioned',
      source: 'quality_admin',
      entityType: 'controlled_quality_experiment',
      entityId: experiment.id,
      actorId: req.user?.id,
      payload: {
        qualityReviewId: experiment.quality_review_id,
        status: experiment.status,
        scopeRoutes: experiment.scope_routes,
        sampleLimit: experiment.sample_limit,
        hasOutcome: !!experiment.outcome_summary,
      },
    });
    res.json({ experiment });
  }));

  /** Materializa na fila apenas candidatos recorrentes; não muda prompt, KB ou agente. */
  router.post('/api/quality-audit/memory-pattern-reviews/sync', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const events = await listQualityAuditEvents(tenantId);
    const insights = deriveMemoryCorrectionInsights(events);
    const reviews = await syncMemoryPatternReviewCandidates({
      tenantId,
      candidates: insights.reviewCandidates,
      agentRoutes: insights.byAgentRoute.map((item) => item.route),
      createdBy: req.user?.id || null,
    });
    await recordQualityAuditEvent({
      tenantId,
      eventType: 'memory_pattern_queue_synced',
      source: 'quality_admin',
      entityType: 'memory_pattern_review_queue',
      actorId: req.user?.id,
      payload: { patternKeys: reviews.map((review) => review.pattern_key), count: reviews.length },
    });
    res.json({ reviews });
  }));

  /**
   * Registra uma decisão humana sobre um padrão. Somente as decisões explícitas
   * knowledge_draft e prompt_test criam um item de Qualidade para continuidade;
   * nenhuma delas publica conteúdo nem altera o agente automaticamente.
   */
  router.patch('/api/quality-audit/memory-pattern-reviews/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const requestedStatus = req.body?.status;
    const allowedStatuses: MemoryPatternReviewStatus[] = ['observed', 'knowledge_draft', 'prompt_test', 'dismissed'];
    if (!allowedStatuses.includes(requestedStatus)) return res.status(400).json({ error: 'Decisão de padrão inválida.' });

    const tenantId = tenantOf(req);
    const existing = (await listMemoryPatternReviews(tenantId)).find((review) => review.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Padrão não encontrado.' });

    let linkedQualityReviewId = existing.linked_quality_review_id;
    if (!linkedQualityReviewId && (requestedStatus === 'knowledge_draft' || requestedStatus === 'prompt_test')) {
      const kind = requestedStatus === 'knowledge_draft' ? 'knowledge' : 'ai_suggestion';
      const followUp = await createQualityReview({
        tenantId,
        kind,
        status: requestedStatus === 'prompt_test' ? 'testing' : 'pending',
        title: requestedStatus === 'knowledge_draft'
          ? `Revisar conhecimento para padrão: ${existing.pattern_key}`
          : `Teste controlado para padrão: ${existing.pattern_key}`,
        description: `Origem: ${existing.evidence_count} correções humanas agregadas. Revise evidências redigidas antes de qualquer alteração publicada.`,
        context: {
          source: 'memory_pattern_review',
          patternKey: existing.pattern_key,
          evidenceCount: existing.evidence_count,
          agentRoutes: existing.agent_routes,
        },
        createdBy: req.user?.id || null,
      });
      linkedQualityReviewId = followUp.id;
    }

    const review = await decideMemoryPatternReview({
      tenantId,
      reviewId: existing.id,
      status: requestedStatus,
      reviewNote: req.body?.reviewNote,
      decidedBy: req.user?.id || null,
      linkedQualityReviewId,
    });
    if (!review) return res.status(404).json({ error: 'Padrão não encontrado.' });
    await recordQualityAuditEvent({
      tenantId,
      eventType: 'memory_pattern_review_decided',
      source: 'quality_admin',
      entityType: 'memory_pattern_review',
      entityId: review.id,
      actorId: req.user?.id,
      payload: {
        patternKey: review.pattern_key,
        decision: review.status,
        evidenceCount: review.evidence_count,
        linkedQualityReview: !!review.linked_quality_review_id,
      },
    });
    res.json({ review });
  }));

  // Operadores podem sugerir melhorias e reportar bugs, mas não podem publicar
  // regras nem alterar o status de uma revisão administrativa.
  router.post('/api/quality-audit/reviews', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { kind, title, description, context, confidence, originalValue, correctedValue } = req.body || {};
    const requestedKind = parseKind(kind);
    if (!requestedKind || !title || !description) {
      return res.status(400).json({ error: 'kind, title e description são obrigatórios.' });
    }
    if ((requestedKind === 'knowledge' || requestedKind === 'ai_suggestion') && req.user?.role !== 'admin' && req.user?.role !== 'saas_admin') {
      return res.status(403).json({ error: 'Somente administradores podem registrar conhecimento ou sugestão de IA.' });
    }
    const review = await createQualityReview({
      tenantId: tenantOf(req),
      kind: requestedKind,
      title: String(title),
      description: String(description),
      context: safeContext(context),
      confidence: typeof confidence === 'number' ? confidence : null,
      originalValue: originalValue == null ? null : String(originalValue),
      correctedValue: correctedValue == null ? null : String(correctedValue),
      createdBy: req.user?.id || null,
    });
    await recordQualityAuditEvent({
      tenantId: tenantOf(req),
      eventType: 'quality_review_created',
      source: 'operator_panel',
      entityType: 'quality_review',
      entityId: review.id,
      actorId: req.user?.id,
      payload: { kind: review.kind, title: review.title },
    });
    res.status(201).json({ review });
  }));

  router.patch('/api/quality-audit/reviews/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { status, reviewNote, correctedValue } = req.body || {};
    const parsedStatus = status === undefined ? undefined : parseStatus(status);
    if (status !== undefined && !parsedStatus) return res.status(400).json({ error: 'Status de revisão inválido.' });
    const review = await updateQualityReview({
      tenantId: tenantOf(req),
      reviewId: req.params.id,
      status: parsedStatus,
      reviewNote: reviewNote === undefined ? undefined : String(reviewNote || ''),
      correctedValue: correctedValue === undefined ? undefined : String(correctedValue || ''),
      reviewedBy: req.user?.id || null,
    });
    if (!review) return res.status(404).json({ error: 'Revisão não encontrada.' });
    await recordQualityAuditEvent({
      tenantId: tenantOf(req),
      eventType: 'quality_review_updated',
      source: 'quality_admin',
      entityType: 'quality_review',
      entityId: review.id,
      actorId: req.user?.id,
      payload: { status: review.status, reviewNote: review.review_note || null },
    });
    res.json({ review });
  }));

  router.post('/api/quality-audit/feedback', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { reviewId, decision, note, originalValue, correctedValue, context } = req.body || {};
    if (!['accepted', 'corrected', 'rejected', 'uncertain'].includes(decision)) {
      return res.status(400).json({ error: 'decision precisa ser accepted, corrected, rejected ou uncertain.' });
    }
    const tenantId = tenantOf(req);
    let reviewIdToAudit = typeof reviewId === 'string' ? reviewId : undefined;
    if (reviewIdToAudit && req.user?.role !== 'admin' && req.user?.role !== 'saas_admin') {
      return res.status(403).json({ error: 'Somente administradores podem revisar uma sugestão existente.' });
    }
    if (reviewIdToAudit) {
      const status: QualityReviewStatus = decision === 'rejected' ? 'rejected' : decision === 'accepted' ? 'approved' : 'testing';
      const updated = await updateQualityReview({
        tenantId,
        reviewId: reviewIdToAudit,
        status,
        reviewNote: note == null ? null : String(note),
        correctedValue: correctedValue == null ? undefined : String(correctedValue),
        reviewedBy: req.user?.id || null,
      });
      if (!updated) return res.status(404).json({ error: 'Sugestão não encontrada.' });
    } else {
      const created = await createQualityReview({
        tenantId,
        kind: 'ai_suggestion',
        title: 'Feedback do operador sobre uma sugestão da IA',
        description: note ? String(note) : `Decisão do operador: ${String(decision)}`,
        context: { ...safeContext(context), decision },
        originalValue: originalValue == null ? null : String(originalValue),
        correctedValue: correctedValue == null ? null : String(correctedValue),
        createdBy: req.user?.id || null,
      });
      reviewIdToAudit = created.id;
    }
    const event = await recordQualityAuditEvent({
      tenantId,
      eventType: 'operator_feedback',
      source: 'operator_panel',
      entityType: 'quality_review',
      entityId: reviewIdToAudit,
      actorId: req.user?.id,
      payload: { decision, note: note || null, originalValue: originalValue || null, correctedValue: correctedValue || null, context: safeContext(context) },
    });
    res.status(201).json({ success: true, reviewId: reviewIdToAudit, event });
  }));

  return router;
}
