import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock3,
  FileSearch,
  Filter,
  Lightbulb,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { useAppPreferences } from '../contexts/AppPreferencesContext';

interface QualityReview {
  id: string;
  tenant_id: string;
  kind: 'ai_suggestion' | 'bug' | 'operator_idea' | 'knowledge';
  status: 'pending' | 'approved' | 'testing' | 'published' | 'rejected' | 'resolved' | 'reopened';
  title: string;
  description: string;
  context: Record<string, unknown>;
  confidence?: number | null;
  original_value?: string | null;
  corrected_value?: string | null;
  created_by?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
}

interface QualityAuditEvent {
  id: string;
  event_type: string;
  source: string;
  entity_type?: string | null;
  entity_id?: string | null;
  conversation_phone?: string | null;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface QualityRecommendation {
  id: string;
  title: string;
  description: string;
  evidenceCount: number;
  action: 'review' | 'test' | 'group';
  kind: QualityReview['kind'];
}

type AgentRoute = 'triagem' | 'faq' | 'agendamento' | 'reclamacao' | 'unknown';

interface MemoryCorrectionInsights {
  totalCorrections: number;
  topFields: Array<{ field: string; count: number }>;
  byAgentRoute: Array<{ route: AgentRoute; count: number }>;
  recentCorrections: Array<{ createdAt: string; fields: string[]; agentRoute: AgentRoute }>;
  reviewCandidates: Array<{ field: string; count: number }>;
}

type MemoryPatternReviewStatus = 'pending' | 'observed' | 'knowledge_draft' | 'prompt_test' | 'dismissed';

interface MemoryPatternReview {
  id: string;
  pattern_key: string;
  evidence_count: number;
  agent_routes: AgentRoute[];
  status: MemoryPatternReviewStatus;
  review_note: string | null;
  linked_quality_review_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ControlledExperiment {
  id: string;
  quality_review_id: string;
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'rejected';
  hypothesis: string;
  variation_summary: string;
  scope_routes: Array<'triagem' | 'faq' | 'reclamacao'>;
  sample_limit: number;
  success_criteria: string[];
  stop_conditions: string[];
  outcome_summary: string | null;
  decision_note: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ControlledExperimentResult {
  experimentId: string;
  availability: 'not_started' | 'insufficient_data' | 'available';
  baselineStart: string | null;
  baselineEnd: string | null;
  observationStart: string | null;
  observationEnd: string | null;
  windowHours: number;
  metrics: Array<{ key: 'human_corrections' | 'escalations' | 'blocked_responses'; label: string; before: number; after: number; delta: number; interpretation: 'improved' | 'worsened' | 'stable' }>;
  limitations: string[];
}

interface QualityAuditCenterProps {
  onToast: (message: string) => void;
}

type CenterTab = 'overview' | 'reviews' | 'bugs' | 'ideas' | 'knowledge' | 'memory' | 'experiments' | 'events';
type ComposerKind = 'bug' | 'operator_idea';

const KIND_LABELS: Record<QualityReview['kind'], string> = {
  ai_suggestion: 'Sugestão da IA',
  bug: 'Bug / incidente',
  operator_idea: 'Ideia do operador',
  knowledge: 'Conhecimento aprovado',
};

const STATUS_LABELS: Record<QualityReview['status'], string> = {
  pending: 'Aguardando revisão',
  approved: 'Aprovada',
  testing: 'Em teste',
  published: 'Publicada',
  rejected: 'Rejeitada',
  resolved: 'Resolvido',
  reopened: 'Reaberto',
};

const STATUS_CLASSES: Record<QualityReview['status'], string> = {
  pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  testing: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  published: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  resolved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  reopened: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
};

function kindIcon(kind: QualityReview['kind']) {
  if (kind === 'ai_suggestion') return <Sparkles className="w-4 h-4 text-sky-300" />;
  if (kind === 'bug') return <BugIcon />;
  if (kind === 'operator_idea') return <Lightbulb className="w-4 h-4 text-amber-300" />;
  return <ShieldCheck className="w-4 h-4 text-emerald-300" />;
}

function BugIcon() {
  return <AlertTriangle className="w-4 h-4 text-rose-300" />;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function getDecision(review: QualityReview) {
  const decision = review.context?.decision;
  return typeof decision === 'string' ? decision : null;
}

function confidenceLabel(confidence: number | null | undefined) {
  if (typeof confidence !== 'number') return 'Não informada';
  return `${Math.round(confidence * 100)}%`;
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  preferredLanguage: 'Idioma',
  preferredName: 'Nome',
  currentIntent: 'Intenção',
  serviceInterest: 'Interesse',
  objections: 'Objeções',
  nextBestAction: 'Próximo passo',
  name: 'Nome',
  email: 'E-mail',
  stage: 'Etapa comercial',
  dealValue: 'Valor da oportunidade',
  assignedOperator: 'Responsável',
  notes: 'Anotações',
  tasks: 'Tarefas',
};

function auditSourceLabel(source: string) {
  const labels: Record<string, string> = {
    crm_panel: 'CRM',
    operator_panel: 'Painel do operador',
    quality_admin: 'Central de Qualidade',
    operator_payment_review: 'Revisão de pagamento',
    atendimento_context_panel: 'Contexto supervisionado do Atendimento',
  };
  return labels[source] || 'Operação';
}

function readableAuditField(value: unknown) {
  const key = typeof value === 'string' ? value : '';
  return AUDIT_FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').trim() || 'Dados do cadastro';
}

function auditEventPresentation(event: QualityAuditEvent) {
  const payload = event.payload || {};
  const changedFields = Array.isArray(payload.changedFields) ? payload.changedFields.map(readableAuditField).filter(Boolean) : [];
  const decision = typeof payload.decision === 'string' ? payload.decision : '';
  const decisionLabel: Record<string, string> = { accepted: 'aceitou', corrected: 'corrigiu', rejected: 'rejeitou', uncertain: 'marcou como incerta', verified: 'aprovou', rejected_payment: 'rejeitou' };

  switch (event.event_type) {
    case 'crm_lead_updated':
      return {
        title: 'Dados do lead atualizados',
        summary: changedFields.length ? `Foram atualizados: ${changedFields.join(', ')}.` : 'O cadastro do lead foi atualizado.',
      };
    case 'conversation_label_added':
      return { title: 'Etiqueta adicionada à conversa', summary: typeof payload.label === 'string' ? `A etiqueta “${payload.label}” foi adicionada.` : 'Uma etiqueta foi adicionada à conversa.' };
    case 'conversation_label_removed':
      return { title: 'Etiqueta removida da conversa', summary: typeof payload.label === 'string' ? `A etiqueta “${payload.label}” foi removida.` : 'Uma etiqueta foi removida da conversa.' };
    case 'payment_receipt_reviewed':
      return { title: 'Comprovante de pagamento revisado', summary: decision === 'verified' ? 'O comprovante foi aprovado e não requer nova revisão.' : 'O comprovante foi recusado e requer acompanhamento.' };
    case 'quality_review_created':
      return { title: 'Item enviado para revisão', summary: typeof payload.title === 'string' ? `“${payload.title}” foi adicionado à Central de Qualidade.` : 'Um novo item foi enviado para revisão.' };
    case 'quality_review_updated':
      return { title: 'Decisão de qualidade atualizada', summary: typeof payload.status === 'string' ? `O item foi marcado como “${STATUS_LABELS[payload.status as QualityReview['status']] || payload.status}”.` : 'O status de um item de qualidade foi atualizado.' };
    case 'operator_feedback':
      return { title: 'Feedback do operador registrado', summary: decision ? `O operador ${decisionLabel[decision] || 'registrou uma decisão sobre'} a sugestão da IA.` : 'O operador registrou feedback sobre uma sugestão da IA.' };
    case 'contact_memory_corrected':
      return { title: 'Memória do contato corrigida', summary: changedFields.length ? `Campos corrigidos: ${changedFields.join(', ')}. A alteração permanece sob revisão humana.` : 'Uma memória de contato foi corrigida sob revisão humana.' };
    case 'memory_pattern_queue_synced':
      return { title: 'Fila de padrões atualizada', summary: typeof payload.count === 'number' && payload.count > 0 ? `${payload.count} padrão(ões) recorrente(s) foram preparados para decisão humana.` : 'Não havia evidência recorrente suficiente para criar novos itens na fila.' };
    case 'memory_pattern_review_decided':
      return { title: 'Decisão sobre padrão registrada', summary: typeof payload.patternKey === 'string' ? `O padrão “${readableAuditField(payload.patternKey)}” recebeu uma decisão administrativa; nenhuma mudança automática foi aplicada.` : 'Uma decisão administrativa sobre padrão foi registrada.' };
    case 'controlled_experiment_created':
      return { title: 'Experimento controlado desenhado', summary: 'Foi registrado um protocolo limitado para revisão humana; nenhuma variação foi publicada.' };
    case 'controlled_experiment_transitioned':
      return { title: 'Estado do experimento atualizado', summary: typeof payload.status === 'string' ? `O experimento foi marcado como “${EXPERIMENT_STATUS_LABELS[payload.status as ControlledExperiment['status']] || payload.status}”, sem alteração automática no agente.` : 'O estado de um experimento foi atualizado sob supervisão humana.' };
    default:
      return { title: 'Atualização registrada', summary: 'Uma atualização operacional foi registrada nesta linha do tempo.' };
  }
}

const EMPTY_MEMORY_CORRECTION_INSIGHTS: MemoryCorrectionInsights = {
  totalCorrections: 0,
  topFields: [],
  byAgentRoute: [],
  recentCorrections: [],
  reviewCandidates: [],
};

const AGENT_ROUTE_LABELS: Record<AgentRoute, string> = {
  triagem: 'Triagem',
  faq: 'Dúvidas e informações',
  agendamento: 'Agendamento',
  reclamacao: 'Reclamação',
  unknown: 'Sem rota registrada',
};
const SAFE_MEMORY_CORRECTION_FIELDS = new Set(['preferredLanguage', 'preferredName', 'currentIntent', 'serviceInterest', 'objections', 'nextBestAction']);
function isSafeMemoryCorrectionField(value: unknown): value is string {
  return typeof value === 'string' && SAFE_MEMORY_CORRECTION_FIELDS.has(value);
}
function safeAgentRouteLabel(value: unknown): string {
  return typeof value === 'string' && value in AGENT_ROUTE_LABELS ? AGENT_ROUTE_LABELS[value as AgentRoute] : AGENT_ROUTE_LABELS.unknown;
}

function conversationReference(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `Conversa final ${digits.slice(-4)}` : 'Conversa vinculada';
}

export const QualityAuditCenter: React.FC<QualityAuditCenterProps> = ({ onToast }) => {
  const { language } = useAppPreferences();
  const isSpanish = language === 'es';
  const [activeTab, setActiveTab] = useState<CenterTab>('overview');
  const [reviews, setReviews] = useState<QualityReview[]>([]);
  const [events, setEvents] = useState<QualityAuditEvent[]>([]);
  const [recommendations, setRecommendations] = useState<QualityRecommendation[]>([]);
  const [metrics, setMetrics] = useState({ totalReviews: 0, pendingCount: 0, correctedCount: 0, rejectedCount: 0, lowConfidenceCount: 0, totalEvents: 0 });
  const [memoryCorrectionInsights, setMemoryCorrectionInsights] = useState<MemoryCorrectionInsights>(EMPTY_MEMORY_CORRECTION_INSIGHTS);
  const [memoryPatternReviews, setMemoryPatternReviews] = useState<MemoryPatternReview[]>([]);
  const [controlledExperiments, setControlledExperiments] = useState<ControlledExperiment[]>([]);
  const [mandatoryExperimentStops, setMandatoryExperimentStops] = useState<string[]>([]);
  const [submittingExperiment, setSubmittingExperiment] = useState(false);
  const [transitioningExperimentId, setTransitioningExperimentId] = useState<string | null>(null);
  const [experimentResults, setExperimentResults] = useState<Record<string, ControlledExperimentResult>>({});
  const [loadingExperimentResultId, setLoadingExperimentResultId] = useState<string | null>(null);
  const [syncingMemoryPatternQueue, setSyncingMemoryPatternQueue] = useState(false);
  const [decidingMemoryPatternId, setDecidingMemoryPatternId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QualityReview['status']>('all');
  const [kindFilter, setKindFilter] = useState<'all' | QualityReview['kind']>('all');
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [composerKind, setComposerKind] = useState<ComposerKind>('operator_idea');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerDescription, setComposerDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiFetch('/api/quality-audit');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar a Central de Qualidade.');
      setReviews(data.reviews || []);
      setEvents(data.events || []);
      setRecommendations(data.recommendations || []);
      setMemoryCorrectionInsights(data.memoryCorrectionInsights || EMPTY_MEMORY_CORRECTION_INSIGHTS);
      setMemoryPatternReviews(data.memoryPatternReviews || []);
      setControlledExperiments(data.controlledExperiments || []);
      setMandatoryExperimentStops(Array.isArray(data.mandatoryExperimentStopConditions) ? data.mandatoryExperimentStopConditions.filter((item: unknown): item is string => typeof item === 'string') : []);
      setMetrics(data.metrics || { totalReviews: 0, pendingCount: 0, correctedCount: 0, rejectedCount: 0, lowConfidenceCount: 0, totalEvents: 0 });
    } catch (error: any) {
      setLoadError(error?.message || 'Não foi possível carregar os dados de auditoria.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredReviews = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return reviews.filter((review) => {
      const matchesTab = activeTab === 'reviews'
        ? review.kind === 'ai_suggestion'
        : activeTab === 'bugs'
        ? review.kind === 'bug'
        : activeTab === 'ideas'
        ? review.kind === 'operator_idea'
        : activeTab === 'knowledge'
        ? review.kind === 'knowledge'
        : true;
      const matchesStatus = statusFilter === 'all' || review.status === statusFilter;
      const matchesKind = kindFilter === 'all' || review.kind === kindFilter;
      const matchesText = !normalizedSearch || `${review.title} ${review.description} ${review.review_note || ''}`.toLowerCase().includes(normalizedSearch);
      return matchesTab && matchesStatus && matchesKind && matchesText;
    });
  }, [activeTab, kindFilter, reviews, search, statusFilter]);

  const selectedReview = reviews.find((review) => review.id === selectedReviewId) || null;

  const updateReview = async (reviewId: string, status: QualityReview['status']) => {
    try {
      const response = await apiFetch(`/api/quality-audit/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewNote }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível atualizar a revisão.');
      setReviews((current) => current.map((review) => review.id === reviewId ? data.review : review));
      setSelectedReviewId(null);
      setReviewNote('');
      onToast(`Item ${STATUS_LABELS[status].toLowerCase()} com sucesso.`);
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível atualizar a revisão.');
    }
  };

  const syncMemoryPatternQueue = async () => {
    setSyncingMemoryPatternQueue(true);
    try {
      const response = await apiFetch('/api/quality-audit/memory-pattern-reviews/sync', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível atualizar a fila de padrões.');
      onToast(data?.reviews?.length ? 'Fila de padrões atualizada para revisão humana.' : 'Ainda não há padrão recorrente suficiente para a fila.');
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível atualizar a fila de padrões.');
    } finally {
      setSyncingMemoryPatternQueue(false);
    }
  };

  const decideMemoryPattern = async (reviewId: string, status: Exclude<MemoryPatternReviewStatus, 'pending'>, reviewNote?: string) => {
    setDecidingMemoryPatternId(reviewId);
    try {
      const response = await apiFetch(`/api/quality-audit/memory-pattern-reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewNote }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar a decisão do padrão.');
      const labels: Record<Exclude<MemoryPatternReviewStatus, 'pending'>, string> = {
        observed: 'mantido em observação',
        knowledge_draft: 'encaminhado para rascunho de conhecimento',
        prompt_test: 'encaminhado para teste controlado',
        dismissed: 'dispensado',
      };
      onToast(`Padrão ${labels[status]}. Nenhuma mudança foi aplicada ao agente automaticamente.`);
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível registrar a decisão do padrão.');
    } finally {
      setDecidingMemoryPatternId(null);
    }
  };

  const createControlledExperiment = async (payload: {
    qualityReviewId: string;
    hypothesis: string;
    variationSummary: string;
    scopeRoutes: string[];
    sampleLimit: number;
    successCriteria: string[];
    stopConditions: string[];
  }) => {
    setSubmittingExperiment(true);
    try {
      const response = await apiFetch('/api/quality-audit/controlled-experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar o experimento.');
      onToast('Experimento criado como rascunho. Ele não altera o agente nem publica uma variação.');
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível registrar o experimento.');
    } finally {
      setSubmittingExperiment(false);
    }
  };

  const transitionControlledExperiment = async (experimentId: string, status: ControlledExperiment['status'], decisionNote?: string, outcomeSummary?: string) => {
    setTransitioningExperimentId(experimentId);
    try {
      const response = await apiFetch(`/api/quality-audit/controlled-experiments/${encodeURIComponent(experimentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, decisionNote, outcomeSummary }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar a transição do experimento.');
      const labels: Record<ControlledExperiment['status'], string> = {
        draft: 'rascunho', ready: 'pronto para avaliação', running: 'em acompanhamento manual', paused: 'pausado', completed: 'concluído', rejected: 'encerrado',
      };
      onToast(`Experimento ${labels[status]}. Nenhuma alteração automática foi aplicada ao agente.`);
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível registrar a transição do experimento.');
    } finally {
      setTransitioningExperimentId(null);
    }
  };

  const loadControlledExperimentResult = async (experimentId: string) => {
    setLoadingExperimentResultId(experimentId);
    try {
      const response = await apiFetch(`/api/quality-audit/controlled-experiments/${encodeURIComponent(experimentId)}/results`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível calcular o resultado do experimento.');
      if (data?.result) setExperimentResults((current) => ({ ...current, [experimentId]: data.result }));
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível calcular o resultado do experimento.');
    } finally {
      setLoadingExperimentResultId(null);
    }
  };

  const submitComposer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!composerTitle.trim() || !composerDescription.trim()) return;
    setSubmitting(true);
    try {
      const response = await apiFetch('/api/quality-audit/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: composerKind, title: composerTitle.trim(), description: composerDescription.trim(), context: { source: 'central_quality' } }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar o item.');
      setReviews((current) => [data.review, ...current]);
      setComposerTitle('');
      setComposerDescription('');
      setShowComposer(false);
      onToast(composerKind === 'bug' ? 'Bug registrado para triagem.' : 'Sugestão registrada para avaliação.');
      await loadData();
    } catch (error: any) {
      onToast(error?.message || 'Não foi possível registrar o item.');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: Array<{ id: CenterTab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'overview', label: isSpanish ? 'Vista general' : 'Visão geral', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'reviews', label: isSpanish ? 'Revisión de IA' : 'Revisão da IA', icon: <Sparkles className="w-4 h-4" />, count: reviews.filter((review) => review.kind === 'ai_suggestion' && review.status === 'pending').length },
    { id: 'bugs', label: 'Bugs', icon: <BugIcon />, count: reviews.filter((review) => review.kind === 'bug' && !['resolved', 'rejected'].includes(review.status)).length },
    { id: 'ideas', label: isSpanish ? 'Ideas' : 'Ideias', icon: <Lightbulb className="w-4 h-4" />, count: reviews.filter((review) => review.kind === 'operator_idea' && review.status === 'pending').length },
    { id: 'knowledge', label: isSpanish ? 'Conocimiento' : 'Conhecimento', icon: <LockKeyhole className="w-4 h-4" /> },
    { id: 'memory', label: isSpanish ? 'Memoria' : 'Memória', icon: <Wrench className="w-4 h-4" />, count: memoryPatternReviews.filter((review) => review.status === 'pending').length || memoryCorrectionInsights.totalCorrections },
    { id: 'experiments', label: isSpanish ? 'Experimentos' : 'Experimentos', icon: <FileSearch className="w-4 h-4" />, count: controlledExperiments.filter((experiment) => ['draft', 'ready', 'running', 'paused'].includes(experiment.status)).length },
    { id: 'events', label: isSpanish ? 'Auditoría' : 'Auditoria', icon: <ClipboardCheck className="w-4 h-4" />, count: events.length },
  ];

  return (
    <section className="quality-workspace space-y-5 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold uppercase tracking-[0.18em]">
            <ShieldCheck className="w-4 h-4" /> {isSpanish ? 'Mejoras de la operación' : 'Melhorias da operação'}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mt-2">{isSpanish ? 'Mejoras del servicio' : 'Melhorias do atendimento'}</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-3xl">{isSpanish ? 'Acompañá sugerencias, problemas y decisiones que ayudan a mejorar la atención.' : 'Acompanhe sugestões, problemas e decisões que ajudam a melhorar o atendimento.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="inline-flex items-center gap-2 px-3 py-2 rounded-control border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {isSpanish ? 'Actualizar' : 'Atualizar'}
          </button>
          <button onClick={() => setShowComposer(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-control bg-sky-500 text-white text-xs font-bold hover:bg-sky-400 transition-colors">
            <Send className="w-3.5 h-3.5" /> {isSpanish ? 'Registrar ítem' : 'Registrar item'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="quality-workspace__persistence-alert rounded-card border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-200">{isSpanish ? 'La central todavía no pudo consultar la persistencia' : 'Central ainda não conseguiu consultar a persistência'}</p>
            <p className="text-xs text-amber-100/70 mt-1">{loadError} Se a migration 0040 ainda não foi aplicada no banco, a interface já está pronta, mas os registros só aparecerão depois da aplicação.</p>
          </div>
        </div>
      )}

      <div className="quality-workspace__tabs responsive-tab-strip flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-3 py-2 rounded-control text-xs font-semibold whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-sky-500/15 text-sky-200 border border-sky-400/30' : 'text-slate-400 border border-transparent hover:bg-slate-800 hover:text-white'}`}>
            {tab.icon}
            {tab.label}
            {typeof tab.count === 'number' && <span className="px-1.5 py-0.5 rounded-pill text-[10px] bg-slate-800 text-slate-300">{tab.count}</span>}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <MetricCard label={isSpanish ? 'Pendientes' : 'Pendentes'} value={metrics.pendingCount} tone="amber" icon={<Clock3 className="w-4 h-4" />} />
            <MetricCard label={isSpanish ? 'Corregidas' : 'Corrigidas'} value={metrics.correctedCount} tone="sky" icon={<Wrench className="w-4 h-4" />} />
            <MetricCard label={isSpanish ? 'Rechazadas' : 'Rejeitadas'} value={metrics.rejectedCount} tone="rose" icon={<ThumbsDown className="w-4 h-4" />} />
            <MetricCard label={isSpanish ? 'Baja confianza' : 'Baixa confiança'} value={metrics.lowConfidenceCount} tone="sky" icon={<CircleDot className="w-4 h-4" />} />
            <MetricCard label={isSpanish ? 'Ítems revisados' : 'Itens revisados'} value={metrics.totalReviews} tone="emerald" icon={<CheckCircle2 className="w-4 h-4" />} />
            <MetricCard label="Eventos" value={metrics.totalEvents} tone="slate" icon={<ClipboardCheck className="w-4 h-4" />} />
          </div>

          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-4">
            <div className="bg-slate-900/70 border border-slate-800 rounded-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white">{isSpanish ? 'Sugerencias automáticas para el administrador' : 'Sugestões automáticas para o admin'}</h3>
                  <p className="text-xs text-slate-500 mt-1">{isSpanish ? 'Patrones observados en los registros revisados.' : 'Padrões observados nos registros revisados.'}</p>
                </div>
                <Sparkles className="w-5 h-5 text-sky-300" />
              </div>
              {recommendations.length === 0 ? (
                <EmptyState icon={<Sparkles className="w-5 h-5" />} title="Ainda não há padrão suficiente" text="As recomendações aparecerão quando houver decisões humanas suficientes para comparar." />
              ) : (
                <div className="space-y-2.5">
                  {recommendations.map((recommendation) => (
                    <button key={recommendation.id} onClick={() => setActiveTab(recommendation.kind === 'bug' ? 'bugs' : recommendation.kind === 'operator_idea' ? 'ideas' : 'reviews')} className="w-full text-left flex items-start gap-3 p-3 rounded-panel border border-slate-800 hover:border-sky-500/30 hover:bg-sky-500/5 transition-colors">
                      <div className="w-8 h-8 rounded-control bg-sky-500/10 border border-sky-400/20 flex items-center justify-center flex-shrink-0">{kindIcon(recommendation.kind)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-100">{recommendation.title}</p>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{recommendation.description}</p>
                        <span className="inline-flex items-center gap-1 text-[10px] text-sky-300 mt-2">{recommendation.evidenceCount} evidências <ArrowRight className="w-3 h-3" /></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="quality-workspace__control-card bg-slate-900/70 border border-slate-800 rounded-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white">{isSpanish ? 'Principio de control' : 'Princípio de controle'}</h3>
                  <p className="text-xs text-slate-500 mt-1">{isSpanish ? 'Las acciones críticas requieren confirmación humana.' : 'Ações críticas exigem confirmação humana.'}</p>
                </div>
                <LockKeyhole className="w-5 h-5 text-emerald-300" />
              </div>
              <div className="quality-workspace__control-quote rounded-panel border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-sm leading-relaxed text-emerald-100">“A IA pode classificar um comprovante e sugerir uma cobrança, mas nunca confirmar o pagamento sozinha.”</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <ControlPill label="Sugestão" value="Permitida" tone="sky" />
                <ControlPill label="Correção" value="Registrada" tone="sky" />
                <ControlPill label="Publicação" value="Admin" tone="amber" />
                <ControlPill label="Pagamento" value="Humano" tone="emerald" />
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab !== 'overview' && activeTab !== 'events' && activeTab !== 'memory' && activeTab !== 'experiments' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isSpanish ? 'Buscá por título, descripción u observación...' : 'Buscar por título, descrição ou observação...'} className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-800 rounded-control text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-400/50" />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="appearance-none pl-8 pr-8 py-2.5 bg-slate-900 border border-slate-800 rounded-control text-xs text-slate-300 focus:outline-none focus:border-sky-400/50">
                  <option value="all">{isSpanish ? 'Todos los estados' : 'Todos os estados'}</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <ChevronDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
              <span className="text-[11px] text-slate-500 whitespace-nowrap">{filteredReviews.length} item(ns)</span>
            </div>
          </div>
          {loading ? <LoadingState /> : filteredReviews.length === 0 ? <EmptyState icon={<FileSearch className="w-5 h-5" />} title={isSpanish ? 'No se encontró ningún ítem' : 'Nenhum item encontrado'} text="Quando houver sugestões, bugs ou ideias, eles aparecerão aqui para revisão." /> : (
            <div className="grid xl:grid-cols-2 gap-3">
              {filteredReviews.map((review) => <ReviewCard key={review.id} review={review} onOpen={() => { setSelectedReviewId(review.id); setReviewNote(review.review_note || ''); }} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'memory' && (
        <MemoryCorrectionPatternsPanel
          insights={memoryCorrectionInsights}
          reviews={memoryPatternReviews}
          loading={loading}
          isSpanish={isSpanish}
          isSyncing={syncingMemoryPatternQueue}
          decidingReviewId={decidingMemoryPatternId}
          onSyncQueue={() => void syncMemoryPatternQueue()}
          onDecide={(reviewId, status, note) => void decideMemoryPattern(reviewId, status, note)}
        />
      )}

      {activeTab === 'experiments' && (
        <ControlledExperimentsPanel
          testingReviews={reviews.filter((review) => review.status === 'testing')}
          experiments={controlledExperiments}
          mandatoryStops={mandatoryExperimentStops}
          loading={loading}
          isSubmitting={submittingExperiment}
          transitioningExperimentId={transitioningExperimentId}
          experimentResults={experimentResults}
          loadingExperimentResultId={loadingExperimentResultId}
          onCreate={(payload) => void createControlledExperiment(payload)}
          onTransition={(experimentId, status, note, outcome) => void transitionControlledExperiment(experimentId, status, note, outcome)}
          onLoadResult={(experimentId) => void loadControlledExperimentResult(experimentId)}
        />
      )}

      {activeTab === 'events' && (
        <div className="quality-workspace__timeline bg-slate-900/70 border border-slate-800 rounded-card overflow-hidden">
          <div className="quality-workspace__timeline-header p-4 border-b border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Histórico de mudanças</h3>
              <p className="text-xs text-slate-500 mt-1">Veja o que foi alterado e por quem, em linguagem simples.</p>
            </div>
            <ClipboardCheck className="w-5 h-5 text-sky-300" />
          </div>
          {loading ? <LoadingState /> : events.length === 0 ? <EmptyState icon={<ClipboardCheck className="w-5 h-5" />} title="Nenhum evento registrado" text="As decisões e alterações aparecerão nesta linha do tempo." /> : (
            <div className="divide-y divide-slate-800/80">
              {events.map((event) => {
                const presentation = auditEventPresentation(event);
                const conversation = conversationReference(event.conversation_phone);
                return (
                  <article key={event.id} className="quality-workspace__event p-4">
                    <div className="quality-workspace__event-icon"><ClipboardCheck className="w-4 h-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h4 className="quality-workspace__event-title">{presentation.title}</h4>
                        <span className="quality-workspace__event-time">{formatDate(event.created_at)}</span>
                      </div>
                      <p className="quality-workspace__event-summary">{presentation.summary}</p>
                      <p className="quality-workspace__event-meta">Registrado por {auditSourceLabel(event.source)}{conversation ? ` • ${conversation}` : ''}</p>
                      {Object.keys(event.payload || {}).length > 0 && (
                        <details className="quality-workspace__event-details">
                          <summary>Ver detalhes técnicos</summary>
                          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showComposer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowComposer(false)}>
          <form onSubmit={submitComposer} onClick={(event) => event.stopPropagation()} className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-card shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-sky-300 font-bold">Entrada supervisionada</p><h3 className="text-lg font-bold text-white mt-1">Registrar bug ou sugestão</h3></div><button type="button" onClick={() => setShowComposer(false)} className="p-1.5 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setComposerKind('operator_idea')} className={`flex items-center gap-2 p-3 rounded-panel border text-left text-xs ${composerKind === 'operator_idea' ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}><Lightbulb className="w-4 h-4" /> Sugestão de melhoria</button>
              <button type="button" onClick={() => setComposerKind('bug')} className={`flex items-center gap-2 p-3 rounded-panel border text-left text-xs ${composerKind === 'bug' ? 'border-rose-400/40 bg-rose-500/10 text-rose-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}><BugIcon /> Reportar bug</button>
            </div>
            <label className="block"><span className="text-[11px] text-slate-400">Título</span><input required value={composerTitle} onChange={(event) => setComposerTitle(event.target.value)} className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 focus:outline-none focus:border-sky-400/50" placeholder={composerKind === 'bug' ? 'Ex.: Comprovante duplicado no histórico' : 'Ex.: Mostrar cobrança no painel da conversa'} /></label>
            <label className="block"><span className="text-[11px] text-slate-400">Descrição e contexto</span><textarea required rows={5} value={composerDescription} onChange={(event) => setComposerDescription(event.target.value)} className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 resize-none focus:outline-none focus:border-sky-400/50" placeholder="Explique o que aconteceu, o que deveria acontecer e qual impacto isso causa." /></label>
            <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setShowComposer(false)} className="px-3 py-2 rounded-control text-xs text-slate-400 hover:text-white">Cancelar</button><button disabled={submitting} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-control bg-sky-500 text-white text-xs font-bold hover:bg-sky-400 disabled:opacity-50"><Send className="w-3.5 h-3.5" /> {submitting ? 'Salvando...' : 'Registrar'}</button></div>
          </form>
        </div>
      )}

      {selectedReview && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-end" onClick={() => setSelectedReviewId(null)}>
          <aside onClick={(event) => event.stopPropagation()} className="h-full w-full max-w-xl bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="w-9 h-9 rounded-control bg-slate-800 flex items-center justify-center">{kindIcon(selectedReview.kind)}</div><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABELS[selectedReview.kind]}</p><h3 className="text-lg font-bold text-white mt-1">{selectedReview.title}</h3></div></div><button onClick={() => setSelectedReviewId(null)} className="p-1.5 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="flex flex-wrap items-center gap-2 mt-4"><span className={`px-2 py-1 rounded-pill border text-[10px] font-bold ${STATUS_CLASSES[selectedReview.status]}`}>{STATUS_LABELS[selectedReview.status]}</span><span className="text-[10px] text-slate-500">Criado em {formatDate(selectedReview.created_at)}</span>{selectedReview.kind === 'ai_suggestion' && <span className="text-[10px] text-sky-300">Confiança: {confidenceLabel(selectedReview.confidence)}</span>}</div>
            <div className="mt-5 rounded-panel border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">{selectedReview.description}</p></div>
            {(selectedReview.original_value || selectedReview.corrected_value) && <div className="grid sm:grid-cols-2 gap-3 mt-3"><ValueBlock label="Sugestão original" value={selectedReview.original_value || '—'} tone="rose" /><ValueBlock label="Resultado corrigido" value={selectedReview.corrected_value || '—'} tone="emerald" /></div>}
            {Object.keys(selectedReview.context || {}).length > 0 && <div className="mt-3"><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Contexto registrado</p><pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-words bg-slate-950 border border-slate-800 rounded-control p-3">{JSON.stringify(selectedReview.context, null, 2)}</pre></div>}
            <div className="mt-5"><label className="text-[10px] uppercase tracking-wider text-slate-500">Nota da revisão</label><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} placeholder="Explique a decisão para a próxima pessoa que consultar este item..." className="mt-1.5 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 resize-none focus:outline-none focus:border-sky-400/50" /></div>
            <div className="mt-5 pt-4 border-t border-slate-800"><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Decisão administrativa</p><div className="grid grid-cols-2 gap-2"><button onClick={() => updateReview(selectedReview.id, 'approved')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25"><Check className="w-3.5 h-3.5" /> Aprovar</button><button onClick={() => updateReview(selectedReview.id, 'testing')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-sky-500/15 border border-sky-400/30 text-sky-200 text-xs font-bold hover:bg-sky-500/25"><Wrench className="w-3.5 h-3.5" /> Enviar para teste</button><button onClick={() => updateReview(selectedReview.id, selectedReview.kind === 'bug' ? 'resolved' : 'rejected')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-rose-500/10 border border-rose-400/30 text-rose-200 text-xs font-bold hover:bg-rose-500/20"><ThumbsDown className="w-3.5 h-3.5" /> {selectedReview.kind === 'bug' ? 'Marcar resolvido' : 'Rejeitar'}</button><button onClick={() => updateReview(selectedReview.id, 'reopened')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-orange-500/10 border border-orange-400/30 text-orange-200 text-xs font-bold hover:bg-orange-500/20"><RotateCcw className="w-3.5 h-3.5" /> Reabrir</button></div></div>
          </aside>
        </div>
      )}
    </section>
  );
};

export function MemoryCorrectionPatternsPanel({
  insights,
  reviews = [],
  loading,
  isSpanish,
  isSyncing = false,
  decidingReviewId = null,
  onSyncQueue,
  onDecide,
}: {
  insights: MemoryCorrectionInsights;
  reviews?: MemoryPatternReview[];
  loading: boolean;
  isSpanish: boolean;
  isSyncing?: boolean;
  decidingReviewId?: string | null;
  onSyncQueue?: () => void;
  onDecide?: (reviewId: string, status: Exclude<MemoryPatternReviewStatus, 'pending'>, note?: string) => void;
}) {
  if (loading) return <LoadingState />;
  const visibleTopFields = insights.topFields.filter((item) => isSafeMemoryCorrectionField(item.field));
  const visibleRoutes = insights.byAgentRoute.filter((item) => typeof item.route === 'string');
  const visibleRecentCorrections = insights.recentCorrections.map((item) => ({ ...item, fields: item.fields.filter(isSafeMemoryCorrectionField) })).filter((item) => item.fields.length > 0);
  const visibleReviewCandidates = insights.reviewCandidates.filter((item) => isSafeMemoryCorrectionField(item.field));
  const topField = visibleTopFields[0] || null;
  const topRoute = visibleRoutes[0] || null;
  const fieldLabel = (field: string) => AUDIT_FIELD_LABELS[field] || readableAuditField(field);

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-sky-500/25 bg-slate-900/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-300"><Wrench className="h-4 w-4" /> {isSpanish ? 'Patrones de memoria' : 'Padrões de memória'}</div>
            <h3 className="mt-2 text-lg font-bold text-white">{isSpanish ? 'Correcciones humanas recurrentes' : 'Correções humanas recorrentes'}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{isSpanish ? 'Esta vista agrupa sólo los campos corregidos y la ruta del agente. Nunca muestra contactos o valores editados y no cambia al agente automáticamente.' : 'Esta visão agrupa somente os campos corrigidos e a rota do agente. Ela nunca mostra contatos ou valores editados e não altera o agente automaticamente.'}</p>
          </div>
          <div className="flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-emerald-100/90 sm:max-w-60"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />{isSpanish ? 'Evidencia para revisión humana; no es una regla automática.' : 'Evidência para revisão humana; não é uma regra automática.'}</div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label={isSpanish ? 'Correcciones' : 'Correções'} value={insights.totalCorrections} tone="sky" icon={<Wrench className="w-4 h-4" />} />
        <MetricCard label={isSpanish ? 'Campo más corregido' : 'Campo mais corrigido'} value={topField?.count || 0} tone="amber" icon={<ClipboardCheck className="w-4 h-4" />} />
        <MetricCard label={isSpanish ? 'Ruta más observada' : 'Rota mais observada'} value={topRoute?.count || 0} tone="emerald" icon={<CircleDot className="w-4 h-4" />} />
      </div>

      {insights.totalCorrections === 0 ? (
        <EmptyState icon={<Wrench className="w-5 h-5" />} title={isSpanish ? 'Aún no hay correcciones de memoria' : 'Ainda não há correções de memória'} text={isSpanish ? 'Cuando operadores corrijan campos seguros en Atención, los patrones aparecerán aquí sin revelar contenido del contacto.' : 'Quando operadores corrigirem campos seguros no Atendimento, os padrões aparecerão aqui sem revelar conteúdo do contato.'} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <section className="rounded-card border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-bold text-white">{isSpanish ? 'Campos que más exigen corrección' : 'Campos que mais exigem correção'}</h4><p className="mt-1 text-[11px] text-slate-500">{isSpanish ? 'Conteo por campo, sin valores ni contactos.' : 'Contagem por campo, sem valores nem contatos.'}</p></div><ClipboardCheck className="h-5 w-5 text-sky-300" /></div>
            <div className="mt-4 space-y-2">
              {visibleTopFields.slice(0, 6).map((item) => {
                const ratio = insights.totalCorrections ? Math.max(8, Math.round((item.count / insights.totalCorrections) * 100)) : 0;
                return <div key={item.field} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-200">{fieldLabel(item.field)}</span><span className="font-bold text-sky-300">{item.count}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-400" style={{ width: `${ratio}%` }} /></div></div>;
              })}
            </div>
          </section>

          <section className="rounded-card border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-bold text-white">{isSpanish ? 'Rutas observadas' : 'Rotas observadas'}</h4><p className="mt-1 text-[11px] text-slate-500">{isSpanish ? 'Ruta del último turno antes de la corrección.' : 'Rota do último turno antes da correção.'}</p></div><CircleDot className="h-5 w-5 text-emerald-300" /></div>
            <div className="mt-4 space-y-2">
              {visibleRoutes.map((item) => <div key={item.route} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5"><span className="text-xs font-semibold text-slate-200">{safeAgentRouteLabel(item.route)}</span><span className="rounded-pill border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">{item.count} {item.count === 1 ? 'correção' : 'correções'}</span></div>)}
            </div>
          </section>
        </div>
      )}

      {visibleReviewCandidates.length > 0 && (
        <section className="rounded-card border border-amber-500/25 bg-amber-500/5 p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><h4 className="text-sm font-bold text-amber-100">{isSpanish ? 'Revisión humana recomendada' : 'Revisão humana recomendada'}</h4><p className="mt-1 text-xs leading-relaxed text-amber-100/75">{isSpanish ? 'Estos campos ya tienen tres o más correcciones. Revise ejemplos y la base de conocimiento antes de proponer cualquier ajuste de prompt o flujo.' : 'Estes campos já somam três ou mais correções. Revise exemplos e a base de conhecimento antes de propor qualquer ajuste de prompt ou fluxo.'}</p><div className="mt-2 flex flex-wrap gap-1.5">{visibleReviewCandidates.map((item) => <span key={item.field} className="rounded-pill border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-100">{fieldLabel(item.field)} · {item.count}</span>)}</div></div></div></section>
      )}

      <MemoryPatternReviewQueue
        reviews={reviews}
        candidates={visibleReviewCandidates}
        isSpanish={isSpanish}
        isSyncing={isSyncing}
        decidingReviewId={decidingReviewId}
        onSyncQueue={onSyncQueue}
        onDecide={onDecide}
      />

      {visibleRecentCorrections.length > 0 && (
        <section className="overflow-hidden rounded-card border border-slate-800 bg-slate-900/70"><div className="border-b border-slate-800 p-4"><h4 className="text-sm font-bold text-white">{isSpanish ? 'Evidencias recientes' : 'Evidências recentes'}</h4><p className="mt-1 text-[11px] text-slate-500">{isSpanish ? 'Secuencia redigida para priorizar revisión; sin datos del contacto.' : 'Sequência redigida para priorizar revisão; sem dados do contato.'}</p></div><div className="divide-y divide-slate-800/80">{visibleRecentCorrections.map((item, index) => <article key={`${item.createdAt}-${index}`} className="p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-1.5">{item.fields.map((field) => <span key={field} className="rounded-pill border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-200">{fieldLabel(field)}</span>)}<span className="rounded-pill border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{safeAgentRouteLabel(item.agentRoute)}</span></div><time className="text-[10px] text-slate-500">{formatDate(item.createdAt)}</time></div></article>)}</div></section>
      )}
    </div>
  );
}

const MEMORY_PATTERN_STATUS_LABELS: Record<MemoryPatternReviewStatus, string> = {
  pending: 'Aguardando decisão',
  observed: 'Manter em observação',
  knowledge_draft: 'Rascunho de conhecimento',
  prompt_test: 'Teste controlado',
  dismissed: 'Dispensado',
};

export function MemoryPatternReviewQueue({
  reviews,
  candidates,
  isSpanish,
  isSyncing,
  decidingReviewId,
  onSyncQueue,
  onDecide,
}: {
  reviews: MemoryPatternReview[];
  candidates: Array<{ field: string; count: number }>;
  isSpanish: boolean;
  isSyncing: boolean;
  decidingReviewId: string | null;
  onSyncQueue?: () => void;
  onDecide?: (reviewId: string, status: Exclude<MemoryPatternReviewStatus, 'pending'>, note?: string) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const visibleReviews = reviews.filter((review) => isSafeMemoryCorrectionField(review.pattern_key));
  const pendingCount = visibleReviews.filter((review) => review.status === 'pending').length;
  const orderedReviews = [...visibleReviews].sort((left, right) => {
    const leftPending = left.status === 'pending';
    const rightPending = right.status === 'pending';
    if (leftPending === rightPending) return right.updated_at.localeCompare(left.updated_at);
    return leftPending ? -1 : 1;
  });
  const fieldLabel = (field: string) => AUDIT_FIELD_LABELS[field] || readableAuditField(field);

  return (
    <section className="overflow-hidden rounded-card border border-slate-800 bg-slate-900/70">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300"><ClipboardCheck className="h-3.5 w-3.5" /> {isSpanish ? 'Fila supervisada' : 'Fila supervisionada'}</div>
          <h4 className="mt-1 text-sm font-bold text-white">{isSpanish ? 'Decisiones sobre patrones recurrentes' : 'Decisões sobre padrões recorrentes'}</h4>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-400">{isSpanish ? 'Cada decisión es administrativa. Crear conocimiento o prueba controlada solo abre un ítem de Calidad; no publica ni cambia el agente.' : 'Cada decisão é administrativa. Criar conhecimento ou teste controlado apenas abre um item de Qualidade; não publica nem altera o agente.'}</p>
        </div>
        {onSyncQueue && <button type="button" onClick={onSyncQueue} disabled={isSyncing || candidates.length === 0} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />{isSyncing ? (isSpanish ? 'Actualizando...' : 'Atualizando...') : (isSpanish ? 'Actualizar fila' : 'Atualizar fila')}</button>}
      </div>

      {visibleReviews.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title={candidates.length ? (isSpanish ? 'Patrones listos para entrar en la fila' : 'Padrões prontos para entrar na fila') : (isSpanish ? 'Sin patrones para revisar' : 'Nenhum padrão para revisar')} text={candidates.length ? (isSpanish ? 'Actualice la fila para materializar estos candidatos y decidir uno por uno.' : 'Atualize a fila para materializar estes candidatos e decidir um por um.') : (isSpanish ? 'La fila se abre cuando un mismo campo alcanza evidencia recurrente.' : 'A fila é aberta quando um mesmo campo alcança evidência recorrente.')} />
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/35 px-4 py-2 text-[10px] text-slate-400"><span>{pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'decisão pendente' : 'decisões pendentes'}` : 'Todas as decisões foram registradas.'}</span><span>Sem conteúdo de contato, mensagens ou valores corrigidos.</span></div>
          {orderedReviews.map((review) => {
            const isPending = review.status === 'pending';
            const isDeciding = decidingReviewId === review.id;
            return (
              <article key={review.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-bold text-white">{fieldLabel(review.pattern_key)}</h5><span className={`rounded-pill border px-2 py-0.5 text-[10px] font-bold ${isPending ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : review.status === 'dismissed' ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'}`}>{MEMORY_PATTERN_STATUS_LABELS[review.status]}</span></div>
                    <p className="mt-1 text-xs text-slate-400">{review.evidence_count} {review.evidence_count === 1 ? 'correção agregada' : 'correções agregadas'} • atualizado em {formatDate(review.updated_at)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{review.agent_routes.map((route) => <span key={route} className="rounded-pill border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[10px] text-slate-300">{safeAgentRouteLabel(route)}</span>)}</div>
                  </div>
                  {review.linked_quality_review_id && <span className="inline-flex items-center gap-1 rounded-pill border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-200"><ArrowRight className="h-3 w-3" /> Item de Qualidade criado</span>}
                </div>

                {isPending ? (
                  <div className="mt-3 rounded-panel border border-slate-800 bg-slate-950/45 p-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">{isSpanish ? 'Nota administrativa opcional' : 'Nota administrativa opcional'}<textarea value={notes[review.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [review.id]: event.target.value }))} maxLength={600} rows={2} placeholder={isSpanish ? 'Justifique la decisión para la próxima revisión...' : 'Justifique a decisão para a próxima revisão...'} className="mt-1.5 w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" /></label>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <button type="button" onClick={() => onDecide?.(review.id, 'observed', notes[review.id])} disabled={!onDecide || isDeciding} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />Manter observação</button>
                      <button type="button" onClick={() => onDecide?.(review.id, 'knowledge_draft', notes[review.id])} disabled={!onDecide || isDeciding} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"><LockKeyhole className="h-3.5 w-3.5" />Rascunho de conhecimento</button>
                      <button type="button" onClick={() => onDecide?.(review.id, 'prompt_test', notes[review.id])} disabled={!onDecide || isDeciding} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"><Wrench className="h-3.5 w-3.5" />Teste controlado</button>
                      <button type="button" onClick={() => onDecide?.(review.id, 'dismissed', notes[review.id])} disabled={!onDecide || isDeciding} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"><ThumbsDown className="h-3.5 w-3.5" />Dispensar</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-start gap-1.5 rounded-panel border border-slate-800 bg-slate-950/45 p-2.5 text-[11px] leading-relaxed text-slate-400"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><span>{review.review_note || 'Decisão registrada sem promover alteração automática no agente.'}</span></div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const EXPERIMENT_STATUS_LABELS: Record<ControlledExperiment['status'], string> = {
  draft: 'Rascunho',
  ready: 'Pronto para avaliação',
  running: 'Acompanhamento manual',
  paused: 'Pausado',
  completed: 'Concluído',
  rejected: 'Encerrado',
};

export function ControlledExperimentsPanel({
  testingReviews,
  experiments,
  mandatoryStops,
  loading,
  isSubmitting,
  transitioningExperimentId,
  experimentResults,
  loadingExperimentResultId,
  onCreate,
  onTransition,
  onLoadResult,
}: {
  testingReviews: QualityReview[];
  experiments: ControlledExperiment[];
  mandatoryStops: string[];
  loading: boolean;
  isSubmitting: boolean;
  transitioningExperimentId: string | null;
  experimentResults: Record<string, ControlledExperimentResult>;
  loadingExperimentResultId: string | null;
  onCreate: (payload: { qualityReviewId: string; hypothesis: string; variationSummary: string; scopeRoutes: string[]; sampleLimit: number; successCriteria: string[]; stopConditions: string[] }) => void;
  onTransition: (experimentId: string, status: ControlledExperiment['status'], decisionNote?: string, outcomeSummary?: string) => void;
  onLoadResult: (experimentId: string) => void;
}) {
  const experimentsByReview = new Set(experiments.map((experiment) => experiment.quality_review_id));
  const availableReviews = testingReviews.filter((review) => !experimentsByReview.has(review.id));
  const [qualityReviewId, setQualityReviewId] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [variationSummary, setVariationSummary] = useState('');
  const [scopeRoutes, setScopeRoutes] = useState<Array<'triagem' | 'faq' | 'reclamacao'>>(['faq']);
  const [sampleLimit, setSampleLimit] = useState(10);
  const [successCriteria, setSuccessCriteria] = useState('Reduzir correções humanas sem elevar escalonamentos ou respostas bloqueadas.');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  if (loading) return <LoadingState />;
  const toggleRoute = (route: 'triagem' | 'faq' | 'reclamacao') => setScopeRoutes((current) => current.includes(route) ? (current.length > 1 ? current.filter((item) => item !== route) : current) : [...current, route]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!qualityReviewId || !hypothesis.trim() || !variationSummary.trim()) return;
    const criteria = successCriteria.split('\n').map((item) => item.trim()).filter(Boolean);
    onCreate({ qualityReviewId, hypothesis, variationSummary, scopeRoutes, sampleLimit, successCriteria: criteria, stopConditions: mandatoryStops });
  };
  const statusClass = (status: ControlledExperiment['status']) => status === 'running' ? 'border-sky-500/30 bg-sky-500/10 text-sky-200' : status === 'ready' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : status === 'paused' ? 'border-orange-500/30 bg-orange-500/10 text-orange-200' : status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : status === 'rejected' ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-slate-700 bg-slate-800 text-slate-200';

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-sky-500/25 bg-slate-900/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300"><FileSearch className="h-3.5 w-3.5" /> Experimento controlado</div><h3 className="mt-1 text-lg font-bold text-white">Teste limitado, reversível e supervisionado</h3><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">O experimento registra hipótese, escopo e critérios para acompanhamento humano. Ele não modifica prompt, roteamento, agenda, pagamento ou o comportamento do agente em produção.</p></div><div className="flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-emerald-100/90 sm:max-w-60"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />Não há ativação automática. Toda mudança de estado é uma decisão administrativa auditável.</div></div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <form onSubmit={submit} className="rounded-card border border-slate-800 bg-slate-900/70 p-4 space-y-3">
          <div><h4 className="text-sm font-bold text-white">Desenhar experimento</h4><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Somente itens já marcados como “Em teste” podem receber este protocolo. A variação é uma descrição de avaliação, não um prompt publicável.</p></div>
          {availableReviews.length === 0 ? <EmptyState icon={<FileSearch className="h-5 w-5" />} title="Nenhum item em teste disponível" text="Encaminhe um padrão recorrente para teste controlado na fila de Memória antes de criar o experimento." /> : <>
            <label className="block"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Item em teste</span><select required value={qualityReviewId} onChange={(event) => setQualityReviewId(event.target.value)} className="mt-1.5 w-full rounded-control border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 focus:border-sky-400/50 focus:outline-none"><option value="">Selecione um item</option>{availableReviews.map((review) => <option key={review.id} value={review.id}>{review.title}</option>)}</select></label>
            <label className="block"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Hipótese</span><textarea required maxLength={600} rows={3} value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="Ex.: uma orientação mais clara pode reduzir correções humanas sem aumentar escalonamentos." className="mt-1.5 w-full resize-none rounded-control border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" /></label>
            <label className="block"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Resumo da variação avaliada</span><textarea required maxLength={800} rows={3} value={variationSummary} onChange={(event) => setVariationSummary(event.target.value)} placeholder="Descreva o que será avaliado, sem colar prompt completo ou publicar regra." className="mt-1.5 w-full resize-none rounded-control border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" /></label>
            <div><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Rotas permitidas</span><div className="mt-1.5 grid grid-cols-3 gap-2">{(['triagem', 'faq', 'reclamacao'] as const).map((route) => <label key={route} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-control border px-2 py-2 text-[10px] font-bold ${scopeRoutes.includes(route) ? 'border-sky-500/35 bg-sky-500/10 text-sky-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}><input className="sr-only" type="checkbox" checked={scopeRoutes.includes(route)} onChange={() => toggleRoute(route)} />{safeAgentRouteLabel(route)}</label>)}</div><p className="mt-1 text-[10px] text-amber-200/80">Agendamento fica fora do escopo; pagamento e confirmação nunca entram no teste.</p></div>
            <label className="block"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Máximo de conversas elegíveis: {sampleLimit}</span><input value={sampleLimit} onChange={(event) => setSampleLimit(Math.min(25, Math.max(1, Number(event.target.value) || 1)))} type="range" min="1" max="25" className="mt-2 w-full accent-sky-400" /><div className="flex justify-between text-[10px] text-slate-600"><span>1</span><span>25</span></div></label>
            <label className="block"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Critérios de sucesso</span><textarea required rows={3} value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} placeholder="Um critério por linha" className="mt-1.5 w-full resize-none rounded-control border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" /></label>
            <div className="rounded-panel border border-rose-500/20 bg-rose-500/5 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-rose-200">Paradas obrigatórias</p><ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-rose-100/80">{mandatoryStops.map((condition) => <li key={condition} className="flex gap-1.5"><X className="mt-0.5 h-3 w-3 shrink-0" />{condition}</li>)}</ul></div>
            <button disabled={isSubmitting} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-control bg-sky-500 px-3 py-2.5 text-xs font-bold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"><FileSearch className="h-3.5 w-3.5" />{isSubmitting ? 'Registrando...' : 'Criar rascunho controlado'}</button>
          </>}
        </form>

        <section className="overflow-hidden rounded-card border border-slate-800 bg-slate-900/70"><div className="border-b border-slate-800 p-4"><h4 className="text-sm font-bold text-white">Acompanhamento administrativo</h4><p className="mt-1 text-[11px] text-slate-500">Registre o protocolo e a decisão; a aplicação prática continua manual e submetida aos gates existentes.</p></div>{experiments.length === 0 ? <div className="p-5"><EmptyState icon={<Clock3 className="h-5 w-5" />} title="Nenhum experimento registrado" text="Crie um rascunho a partir de um item de Qualidade em teste." /></div> : <div className="divide-y divide-slate-800/80">{experiments.map((experiment) => {
          const linkedReview = testingReviews.find((review) => review.id === experiment.quality_review_id);
          const result = experimentResults[experiment.id];
          const isLoadingResult = loadingExperimentResultId === experiment.id;
          const isTransitioning = transitioningExperimentId === experiment.id;
          const canReady = experiment.status === 'draft' || experiment.status === 'paused';
          const canRun = experiment.status === 'ready';
          const canPause = experiment.status === 'ready' || experiment.status === 'running';
          const canComplete = experiment.status === 'running' || experiment.status === 'paused';
          const terminal = experiment.status === 'completed' || experiment.status === 'rejected';
          return <article key={experiment.id} className="p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-bold text-white">{linkedReview?.title || 'Item de Qualidade vinculado'}</h5><span className={`rounded-pill border px-2 py-0.5 text-[10px] font-bold ${statusClass(experiment.status)}`}>{EXPERIMENT_STATUS_LABELS[experiment.status]}</span></div><p className="mt-1 text-[11px] text-slate-500">Amostra máxima: {experiment.sample_limit} • rotas: {experiment.scope_routes.map(safeAgentRouteLabel).join(', ')}</p></div><time className="text-[10px] text-slate-500">{formatDate(experiment.updated_at)}</time></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-panel border border-slate-800 bg-slate-950/45 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Hipótese</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{experiment.hypothesis}</p></div><div className="rounded-panel border border-slate-800 bg-slate-950/45 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Critérios</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{experiment.success_criteria.join(' • ')}</p></div></div><ExperimentResultsPanel result={result} isLoading={isLoadingResult} canLoad={!!experiment.started_at} onLoad={() => onLoadResult(experiment.id)} />{!terminal && <div className="mt-3 rounded-panel border border-slate-800 bg-slate-950/45 p-3"><textarea value={notes[experiment.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [experiment.id]: event.target.value }))} maxLength={600} rows={2} placeholder="Nota administrativa da transição (opcional)..." className="w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" />{canComplete && <textarea value={outcomes[experiment.id] || ''} onChange={(event) => setOutcomes((current) => ({ ...current, [experiment.id]: event.target.value }))} maxLength={800} rows={2} placeholder="Resumo do resultado obrigatório ao concluir..." className="mt-2 w-full resize-none rounded-control border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none" />}<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{canReady && <button type="button" disabled={isTransitioning} onClick={() => onTransition(experiment.id, 'ready', notes[experiment.id])} className="rounded-control border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[10px] font-bold text-amber-200 disabled:opacity-50">Revisar desenho</button>}{canRun && <button type="button" disabled={isTransitioning} onClick={() => onTransition(experiment.id, 'running', notes[experiment.id])} className="rounded-control border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-[10px] font-bold text-sky-200 disabled:opacity-50">Iniciar acompanhamento</button>}{canPause && <button type="button" disabled={isTransitioning} onClick={() => onTransition(experiment.id, 'paused', notes[experiment.id])} className="rounded-control border border-orange-500/30 bg-orange-500/10 px-2 py-2 text-[10px] font-bold text-orange-200 disabled:opacity-50">Pausar</button>}{canComplete && <button type="button" disabled={isTransitioning || !(outcomes[experiment.id] || '').trim()} onClick={() => onTransition(experiment.id, 'completed', notes[experiment.id], outcomes[experiment.id])} className="rounded-control border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-[10px] font-bold text-emerald-200 disabled:opacity-50">Concluir</button>}<button type="button" disabled={isTransitioning} onClick={() => onTransition(experiment.id, 'rejected', notes[experiment.id])} className="rounded-control border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-[10px] font-bold text-rose-200 disabled:opacity-50">Encerrar</button></div></div>}{terminal && <div className="mt-3 flex items-start gap-1.5 rounded-panel border border-slate-800 bg-slate-950/45 p-2.5 text-[11px] leading-relaxed text-slate-400"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><span>{experiment.outcome_summary || experiment.decision_note || 'Experimento encerrado; nenhuma publicação foi promovida automaticamente.'}</span></div>}</article>;
        })}</div>}</section>
      </div>
    </div>
  );
}

function ExperimentResultsPanel({ result, isLoading, canLoad, onLoad }: { result?: ControlledExperimentResult; isLoading: boolean; canLoad: boolean; onLoad: () => void }) {
  const signalStyle: Record<ControlledExperimentResult['metrics'][number]['interpretation'], string> = {
    improved: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200',
    worsened: 'border-rose-500/25 bg-rose-500/5 text-rose-200',
    stable: 'border-slate-700 bg-slate-800/50 text-slate-200',
  };
  const signalLabel: Record<ControlledExperimentResult['metrics'][number]['interpretation'], string> = { improved: 'Sinal favorável', worsened: 'Atenção', stable: 'Estável' };
  return <section className="mt-3 rounded-panel border border-sky-500/20 bg-sky-500/[0.035] p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-300"><FileSearch className="h-3.5 w-3.5" /> Evidências antes/depois</div><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Leitura agregada do tenant em janelas equivalentes. É apoio à revisão humana, não prova causalidade nem publicação automática.</p></div><button type="button" disabled={!canLoad || isLoading} onClick={onLoad} className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-control border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />{isLoading ? 'Calculando...' : 'Atualizar leitura'}</button></div>{!canLoad && <p className="mt-2 rounded-control border border-slate-700 bg-slate-950/50 p-2 text-[11px] text-slate-400">O resultado fica disponível após registrar o início do acompanhamento manual.</p>}{result?.availability === 'not_started' && <p className="mt-2 rounded-control border border-slate-700 bg-slate-950/50 p-2 text-[11px] text-slate-400">Ainda não há janela pós-experimento para comparar.</p>}{result?.availability === 'insufficient_data' && <p className="mt-2 rounded-control border border-amber-500/25 bg-amber-500/5 p-2 text-[11px] text-amber-100">A janela de observação ainda é insuficiente. Aguarde evidência adicional antes de concluir.</p>}{result?.availability === 'available' && <><div className="mt-3 grid gap-2 sm:grid-cols-3">{result.metrics.map((item) => <div key={item.key} className={`rounded-control border p-2.5 ${signalStyle[item.interpretation]}`}><div className="flex items-start justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{item.label}</p><span className="rounded-pill border border-current/20 px-1.5 py-0.5 text-[9px] font-bold">{signalLabel[item.interpretation]}</span></div><div className="mt-2 flex items-end gap-2"><div><p className="text-[9px] uppercase text-slate-500">Antes</p><p className="text-lg font-bold">{item.before}</p></div><span className="mb-1 text-slate-500">→</span><div><p className="text-[9px] uppercase text-slate-500">Depois</p><p className="text-lg font-bold">{item.after}</p></div><span className="mb-1 text-[10px] font-bold">{item.delta > 0 ? '+' : ''}{item.delta}</span></div></div>)}</div><p className="mt-2 text-[10px] text-slate-500">Janela comparada: {result.windowHours}h antes de {result.observationStart ? formatDate(result.observationStart) : '—'} e {result.windowHours}h depois.</p><div className="mt-2 border-t border-slate-800 pt-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Limites da leitura</p><ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-500">{result.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul></div></>}</section>;
}

const toneMap: Record<string, string> = { amber: 'text-amber-300 bg-amber-500/10 border-amber-400/20', sky: 'text-sky-300 bg-sky-500/10 border-sky-400/20', rose: 'text-rose-300 bg-rose-500/10 border-rose-400/20', emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20', slate: 'text-slate-300 bg-slate-500/10 border-slate-400/20' };

function MetricCard({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: React.ReactNode }) {
  return <div className="bg-slate-900/70 border border-slate-800 rounded-panel p-3"><div className={`w-7 h-7 rounded-control border flex items-center justify-center ${toneMap[tone] || toneMap.slate}`}>{icon}</div><p className="text-xl font-bold text-white mt-2">{value.toLocaleString('pt-BR')}</p><p className="text-[10px] text-slate-500 mt-0.5">{label}</p></div>;
}

function ControlPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`quality-workspace__control-pill quality-workspace__control-pill--${tone} rounded-control border border-slate-800 bg-slate-950/60 p-2`}><p className="text-[10px] text-slate-500">{label}</p><p className={`text-[11px] font-semibold mt-0.5 ${tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : tone === 'sky' ? 'text-sky-300' : 'text-sky-300'}`}>{value}</p></div>;
}

const ReviewCard: React.FC<{ review: QualityReview; onOpen: () => void }> = ({ review, onOpen }) => {
  return <button onClick={onOpen} className="w-full text-left bg-slate-900/70 border border-slate-800 hover:border-sky-500/40 rounded-card p-4 transition-colors group"><div className="flex items-start gap-3"><div className="w-8 h-8 rounded-control bg-slate-800 flex items-center justify-center flex-shrink-0">{kindIcon(review.kind)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABELS[review.kind]}</span><span className={`px-1.5 py-0.5 rounded-pill border text-[9px] font-bold ${STATUS_CLASSES[review.status]}`}>{STATUS_LABELS[review.status]}</span></div><h3 className="text-sm font-semibold text-white mt-1 group-hover:text-sky-200 transition-colors">{review.title}</h3><p className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">{review.description}</p><div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-slate-500"><span>{formatDate(review.created_at)}</span>{review.kind === 'ai_suggestion' && <span className="text-sky-300">Confiança {confidenceLabel(review.confidence)}</span>}{getDecision(review) && <span>Decisão: {getDecision(review)}</span>}</div></div><ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-sky-300 transition-colors flex-shrink-0" /></div></button>;
};

function ValueBlock({ label, value, tone }: { label: string; value: string; tone: 'rose' | 'emerald' }) {
  return <div className={`rounded-panel border p-3 ${tone === 'rose' ? 'bg-rose-500/5 border-rose-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}><p className="text-[10px] text-slate-500">{label}</p><p className={`text-xs mt-1 whitespace-pre-wrap break-words ${tone === 'rose' ? 'text-rose-200' : 'text-emerald-200'}`}>{value}</p></div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="p-10 text-center border border-dashed border-slate-800 rounded-card"><div className="w-10 h-10 mx-auto rounded-panel bg-slate-800/70 text-slate-500 flex items-center justify-center">{icon}</div><h3 className="text-sm font-semibold text-slate-300 mt-3">{title}</h3><p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{text}</p></div>;
}

function LoadingState() {
  return <div className="p-10 text-center text-xs text-slate-500"><RefreshCw className="w-5 h-5 mx-auto animate-spin text-sky-300" /><p className="mt-2">Carregando registros de qualidade...</p></div>;
}
