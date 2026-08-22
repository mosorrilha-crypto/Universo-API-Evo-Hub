import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import { requireRole, resolveTenantId } from '../middleware/rbac';
import {
  createQualityReview,
  deriveQualityRecommendations,
  listQualityAuditEvents,
  listQualityReviews,
  recordQualityAuditEvent,
  updateQualityReview,
  type QualityReviewKind,
  type QualityReviewStatus,
} from '../services/qualityAuditStore';

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
    const [reviews, events] = await Promise.all([
      listQualityReviews(tenantOf(req), { kind, status }),
      listQualityAuditEvents(tenantOf(req)),
    ]);
    const pendingCount = reviews.filter((item) => item.status === 'pending').length;
    const correctedCount = reviews.filter((item) => item.context?.decision === 'corrected').length;
    const rejectedCount = reviews.filter((item) => item.context?.decision === 'rejected' || item.status === 'rejected').length;
    const lowConfidenceCount = reviews.filter((item) => typeof item.confidence === 'number' && item.confidence < 0.7).length;
    res.json({
      reviews,
      events,
      recommendations: deriveQualityRecommendations(reviews),
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
