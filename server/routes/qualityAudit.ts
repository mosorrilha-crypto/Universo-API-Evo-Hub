import type { GoogleGenAI } from '@google/genai';
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
import { runAgentEvaluation } from '../services/agentEvalService';
import { createAgentEvalRun, finishAgentEvalRun, listAgentEvalRuns, updateAgentEvalRunProgress } from '../services/agentEvalRunStore';
import { calculateControlledExperimentResult } from '../services/controlledExperimentResults';
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
import { isQualityModuleEnabledForCurrentTenant } from '../services/qualityModuleAccess';

interface QualityAuditRouterDeps {
  authenticateToken: RequestHandler;
  /** Injeção de teste; em produção consulta o entitlement do tenant corrente. */
  isQualityModuleEnabled?: () => Promise<boolean>;
  /** TASK-0208 — avaliação automática (botão "Rodar avaliação automática"). Getter deferido, mesmo padrão já usado em webhooks.ts. */
  getAi?: () => GoogleGenAI | null;
  groqApiKey?: string;
}

const EVAL_RUN_MAX_COUNT = 100;
const EVAL_RUN_MIN_COUNT = 1;

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

export function createQualityAuditRouter({ authenticateToken, isQualityModuleEnabled, getAi, groqApiKey }: QualityAuditRouterDeps): Router {
  const router = Router();
  const qualityModuleEnabled = isQualityModuleEnabled || isQualityModuleEnabledForCurrentTenant;

  function requireQualityModule() {
    return asyncHandler(async (req: AuthenticatedRequest, res, next) => {
      tenantOf(req);
      // O SaaS Admin administra a liberação e precisa auditar todos os tenants.
      if (req.user?.role === 'saas_admin') return next();
      if (!(await qualityModuleEnabled())) {
        return res.status(403).json({
          error: 'Qualidade do agente não está habilitada para esta empresa. Solicite a liberação ao administrador da plataforma.',
          code: 'quality_module_disabled',
        });
      }
      next();
    });
  }

  router.get('/api/quality-audit', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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
  router.post('/api/quality-audit/controlled-experiments', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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

  router.get('/api/quality-audit/controlled-experiments/:id/results', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const experiment = (await listControlledExperiments(tenantId)).find((item) => item.id === req.params.id);
    if (!experiment) return res.status(404).json({ error: 'Experimento não encontrado.' });
    const result = await calculateControlledExperimentResult({ tenantId, experiment });
    res.json({ result });
  }));

  router.patch('/api/quality-audit/controlled-experiments/:id', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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

  /**
   * TASK-0208 — botão "Rodar avaliação automática" (pedido direto do dono
   * do produto, ver TASK-0203). Uma rodada de N casos leva minutos (cada
   * caso faz várias chamadas Gemini sequenciais) — não cabe numa
   * requisição HTTP síncrona, então cria o registro de progresso e
   * responde IMEDIATAMENTE com o runId; a avaliação continua rodando no
   * processo do servidor em background (fire-and-forget controlado —
   * qualquer erro é capturado e gravado em agent_eval_runs.error, nunca
   * derruba o processo). O painel faz polling em GET .../eval-runs pra
   * acompanhar. Os ACHADOS de falha continuam caindo em quality_reviews,
   * igual ao script de terminal (mesma função runAgentEvaluation).
   */
  router.post('/api/quality-audit/eval-runs', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const ai = getAi?.();
    if (!ai) return res.status(503).json({ error: 'Gemini não configurado (GEMINI_API_KEY ausente) — avaliação automática indisponível.' });
    const tenantId = tenantOf(req);
    const rawCount = req.body?.count;
    const parsedCount = Number(rawCount);
    // count=0 é um valor explícito (deve virar EVAL_RUN_MIN_COUNT, não o
    // padrão) — diferente de ausente/inválido, que cai no padrão de 10.
    // `Number(x) || 10` erraria isso: 0 é falsy em JS, cairia no padrão.
    const requestedCount = rawCount === undefined || !Number.isFinite(parsedCount)
      ? 10
      : Math.max(EVAL_RUN_MIN_COUNT, Math.min(parsedCount, EVAL_RUN_MAX_COUNT));

    const run = await createAgentEvalRun({ tenantId, requestedCount, requestedBy: req.user?.id || null });
    res.status(202).json({ run });

    // A partir daqui a resposta HTTP já foi enviada — este bloco roda em
    // background. Nunca deixa uma exceção não tratada escapar (viraria
    // unhandledRejection e derrubaria o processo inteiro, ver CLAUDE.md).
    runAgentEvaluation({
      tenantId,
      ai,
      count: requestedCount,
      groqApiKey,
      onProgress: async ({ completed, passed, failed }) => {
        try {
          await updateAgentEvalRunProgress(run.id, { completedCount: completed, passCount: passed, failCount: failed });
        } catch (err) {
          console.warn(`⚠️  [Avaliação automática] falha ao atualizar progresso do run ${run.id}:`, (err as Error)?.message || err);
        }
      },
    })
      .then(async (summary) => {
        await finishAgentEvalRun(run.id, { status: 'completed', repeatedPhraseCount: summary.repeatedPhrases.length });
      })
      .catch(async (err) => {
        console.warn(`⚠️  [Avaliação automática] run ${run.id} falhou:`, (err as Error)?.message || err);
        try {
          await finishAgentEvalRun(run.id, { status: 'failed', error: (err as Error)?.message || String(err) });
        } catch (persistError) {
          console.warn(`⚠️  [Avaliação automática] falha ao registrar erro do run ${run.id}:`, (persistError as Error)?.message || persistError);
        }
      });
  }));

  router.get('/api/quality-audit/eval-runs', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runs = await listAgentEvalRuns(tenantOf(req));
    res.json({ runs });
  }));

  /** Materializa na fila apenas candidatos recorrentes; não muda prompt, KB ou agente. */
  router.post('/api/quality-audit/memory-pattern-reviews/sync', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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
  router.patch('/api/quality-audit/memory-pattern-reviews/:id', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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
  router.post('/api/quality-audit/reviews', authenticateToken, requireQualityModule(), asyncHandler(async (req: AuthenticatedRequest, res) => {
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

  router.patch('/api/quality-audit/reviews/:id', authenticateToken, requireQualityModule(), requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
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

  router.post('/api/quality-audit/feedback', authenticateToken, requireQualityModule(), asyncHandler(async (req: AuthenticatedRequest, res) => {
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
