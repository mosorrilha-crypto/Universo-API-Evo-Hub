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

interface QualityAuditCenterProps {
  onToast: (message: string) => void;
}

type CenterTab = 'overview' | 'reviews' | 'bugs' | 'ideas' | 'knowledge' | 'events';
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
  published: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  resolved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  reopened: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
};

function kindIcon(kind: QualityReview['kind']) {
  if (kind === 'ai_suggestion') return <Sparkles className="w-4 h-4 text-violet-300" />;
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

export const QualityAuditCenter: React.FC<QualityAuditCenterProps> = ({ onToast }) => {
  const { language } = useAppPreferences();
  const isSpanish = language === 'es';
  const [activeTab, setActiveTab] = useState<CenterTab>('overview');
  const [reviews, setReviews] = useState<QualityReview[]>([]);
  const [events, setEvents] = useState<QualityAuditEvent[]>([]);
  const [recommendations, setRecommendations] = useState<QualityRecommendation[]>([]);
  const [metrics, setMetrics] = useState({ totalReviews: 0, pendingCount: 0, correctedCount: 0, rejectedCount: 0, lowConfidenceCount: 0, totalEvents: 0 });
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
    { id: 'events', label: isSpanish ? 'Auditoría' : 'Auditoria', icon: <ClipboardCheck className="w-4 h-4" />, count: events.length },
  ];

  return (
    <section className="space-y-5 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-violet-300 text-xs font-semibold uppercase tracking-[0.18em]">
            <ShieldCheck className="w-4 h-4" /> {isSpanish ? 'Gobernanza de la operación' : 'Governança da operação'}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mt-2">{isSpanish ? 'Central de Calidad y Aprendizaje' : 'Central de Qualidade & Aprendizado'}</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-3xl">{isSpanish ? 'La IA sugiere. El operador corrige. El administrador decide qué puede convertirse en regla, siempre con historial y posibilidad de reversión.' : 'A IA sugere. O operador corrige. O administrador decide o que pode virar regra, sempre com histórico e possibilidade de reversão.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="inline-flex items-center gap-2 px-3 py-2 rounded-control border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {isSpanish ? 'Actualizar' : 'Atualizar'}
          </button>
          <button onClick={() => setShowComposer(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-control bg-violet-500 text-white text-xs font-bold hover:bg-violet-400 transition-colors">
            <Send className="w-3.5 h-3.5" /> {isSpanish ? 'Registrar ítem' : 'Registrar item'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-200">{isSpanish ? 'La central todavía no pudo consultar la persistencia' : 'Central ainda não conseguiu consultar a persistência'}</p>
            <p className="text-xs text-amber-100/70 mt-1">{loadError} Se a migration 0040 ainda não foi aplicada no banco, a interface já está pronta, mas os registros só aparecerão depois da aplicação.</p>
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-3 py-2 rounded-control text-xs font-semibold whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-violet-500/15 text-violet-200 border border-violet-400/30' : 'text-slate-400 border border-transparent hover:bg-slate-800 hover:text-white'}`}>
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
            <MetricCard label={isSpanish ? 'Baja confianza' : 'Baixa confiança'} value={metrics.lowConfidenceCount} tone="violet" icon={<CircleDot className="w-4 h-4" />} />
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
                <Sparkles className="w-5 h-5 text-violet-300" />
              </div>
              {recommendations.length === 0 ? (
                <EmptyState icon={<Sparkles className="w-5 h-5" />} title="Ainda não há padrão suficiente" text="As recomendações aparecerão quando houver decisões humanas suficientes para comparar." />
              ) : (
                <div className="space-y-2.5">
                  {recommendations.map((recommendation) => (
                    <button key={recommendation.id} onClick={() => setActiveTab(recommendation.kind === 'bug' ? 'bugs' : recommendation.kind === 'operator_idea' ? 'ideas' : 'reviews')} className="w-full text-left flex items-start gap-3 p-3 rounded-panel border border-slate-800 hover:border-violet-500/30 hover:bg-violet-500/5 transition-colors">
                      <div className="w-8 h-8 rounded-control bg-violet-500/10 border border-violet-400/20 flex items-center justify-center flex-shrink-0">{kindIcon(recommendation.kind)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-100">{recommendation.title}</p>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{recommendation.description}</p>
                        <span className="inline-flex items-center gap-1 text-[10px] text-violet-300 mt-2">{recommendation.evidenceCount} evidências <ArrowRight className="w-3 h-3" /></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white">{isSpanish ? 'Principio de control' : 'Princípio de controle'}</h3>
                  <p className="text-xs text-slate-500 mt-1">{isSpanish ? 'Las acciones críticas requieren confirmación humana.' : 'Ações críticas exigem confirmação humana.'}</p>
                </div>
                <LockKeyhole className="w-5 h-5 text-emerald-300" />
              </div>
              <div className="rounded-panel border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-sm leading-relaxed text-emerald-100">“A IA pode classificar um comprovante e sugerir uma cobrança, mas nunca confirmar o pagamento sozinha.”</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <ControlPill label="Sugestão" value="Permitida" tone="violet" />
                <ControlPill label="Correção" value="Registrada" tone="sky" />
                <ControlPill label="Publicação" value="Admin" tone="amber" />
                <ControlPill label="Pagamento" value="Humano" tone="emerald" />
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab !== 'overview' && activeTab !== 'events' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isSpanish ? 'Buscá por título, descripción u observación...' : 'Buscar por título, descrição ou observação...'} className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-800 rounded-control text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-400/50" />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="appearance-none pl-8 pr-8 py-2.5 bg-slate-900 border border-slate-800 rounded-control text-xs text-slate-300 focus:outline-none focus:border-violet-400/50">
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

      {activeTab === 'events' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-card overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Linha do tempo de auditoria</h3>
              <p className="text-xs text-slate-500 mt-1">O que aconteceu, de onde veio e qual resultado foi salvo.</p>
            </div>
            <ClipboardCheck className="w-5 h-5 text-sky-300" />
          </div>
          {loading ? <LoadingState /> : events.length === 0 ? <EmptyState icon={<ClipboardCheck className="w-5 h-5" />} title="Nenhum evento registrado" text="As decisões e alterações aparecerão nesta linha do tempo." /> : (
            <div className="divide-y divide-slate-800/80">
              {events.map((event) => (
                <div key={event.id} className="p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-control bg-sky-500/10 border border-sky-400/20 flex items-center justify-center flex-shrink-0"><ClipboardCheck className="w-4 h-4 text-sky-300" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-100">{event.event_type.replaceAll('_', ' ')}</span><span className="text-[10px] text-slate-500">{formatDate(event.created_at)}</span></div>
                    <p className="text-[11px] text-slate-400 mt-1">Origem: {event.source}{event.conversation_phone ? ` • conversa ${event.conversation_phone}` : ''}</p>
                    {Object.keys(event.payload || {}).length > 0 && <pre className="mt-2 text-[10px] text-slate-500 whitespace-pre-wrap break-words bg-slate-950/60 border border-slate-800 rounded-control p-2">{JSON.stringify(event.payload, null, 2)}</pre>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showComposer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowComposer(false)}>
          <form onSubmit={submitComposer} onClick={(event) => event.stopPropagation()} className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-card shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-violet-300 font-bold">Entrada supervisionada</p><h3 className="text-lg font-bold text-white mt-1">Registrar bug ou sugestão</h3></div><button type="button" onClick={() => setShowComposer(false)} className="p-1.5 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setComposerKind('operator_idea')} className={`flex items-center gap-2 p-3 rounded-panel border text-left text-xs ${composerKind === 'operator_idea' ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}><Lightbulb className="w-4 h-4" /> Sugestão de melhoria</button>
              <button type="button" onClick={() => setComposerKind('bug')} className={`flex items-center gap-2 p-3 rounded-panel border text-left text-xs ${composerKind === 'bug' ? 'border-rose-400/40 bg-rose-500/10 text-rose-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}><BugIcon /> Reportar bug</button>
            </div>
            <label className="block"><span className="text-[11px] text-slate-400">Título</span><input required value={composerTitle} onChange={(event) => setComposerTitle(event.target.value)} className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 focus:outline-none focus:border-violet-400/50" placeholder={composerKind === 'bug' ? 'Ex.: Comprovante duplicado no histórico' : 'Ex.: Mostrar cobrança no painel da conversa'} /></label>
            <label className="block"><span className="text-[11px] text-slate-400">Descrição e contexto</span><textarea required rows={5} value={composerDescription} onChange={(event) => setComposerDescription(event.target.value)} className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 resize-none focus:outline-none focus:border-violet-400/50" placeholder="Explique o que aconteceu, o que deveria acontecer e qual impacto isso causa." /></label>
            <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setShowComposer(false)} className="px-3 py-2 rounded-control text-xs text-slate-400 hover:text-white">Cancelar</button><button disabled={submitting} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-control bg-violet-500 text-white text-xs font-bold hover:bg-violet-400 disabled:opacity-50"><Send className="w-3.5 h-3.5" /> {submitting ? 'Salvando...' : 'Registrar'}</button></div>
          </form>
        </div>
      )}

      {selectedReview && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-end" onClick={() => setSelectedReviewId(null)}>
          <aside onClick={(event) => event.stopPropagation()} className="h-full w-full max-w-xl bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="w-9 h-9 rounded-control bg-slate-800 flex items-center justify-center">{kindIcon(selectedReview.kind)}</div><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABELS[selectedReview.kind]}</p><h3 className="text-lg font-bold text-white mt-1">{selectedReview.title}</h3></div></div><button onClick={() => setSelectedReviewId(null)} className="p-1.5 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="flex flex-wrap items-center gap-2 mt-4"><span className={`px-2 py-1 rounded-pill border text-[10px] font-bold ${STATUS_CLASSES[selectedReview.status]}`}>{STATUS_LABELS[selectedReview.status]}</span><span className="text-[10px] text-slate-500">Criado em {formatDate(selectedReview.created_at)}</span>{selectedReview.kind === 'ai_suggestion' && <span className="text-[10px] text-violet-300">Confiança: {confidenceLabel(selectedReview.confidence)}</span>}</div>
            <div className="mt-5 rounded-panel border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">{selectedReview.description}</p></div>
            {(selectedReview.original_value || selectedReview.corrected_value) && <div className="grid sm:grid-cols-2 gap-3 mt-3"><ValueBlock label="Sugestão original" value={selectedReview.original_value || '—'} tone="rose" /><ValueBlock label="Resultado corrigido" value={selectedReview.corrected_value || '—'} tone="emerald" /></div>}
            {Object.keys(selectedReview.context || {}).length > 0 && <div className="mt-3"><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Contexto registrado</p><pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-words bg-slate-950 border border-slate-800 rounded-control p-3">{JSON.stringify(selectedReview.context, null, 2)}</pre></div>}
            <div className="mt-5"><label className="text-[10px] uppercase tracking-wider text-slate-500">Nota da revisão</label><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} placeholder="Explique a decisão para a próxima pessoa que consultar este item..." className="mt-1.5 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-control text-xs text-slate-200 resize-none focus:outline-none focus:border-violet-400/50" /></div>
            <div className="mt-5 pt-4 border-t border-slate-800"><p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Decisão administrativa</p><div className="grid grid-cols-2 gap-2"><button onClick={() => updateReview(selectedReview.id, 'approved')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25"><Check className="w-3.5 h-3.5" /> Aprovar</button><button onClick={() => updateReview(selectedReview.id, 'testing')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-sky-500/15 border border-sky-400/30 text-sky-200 text-xs font-bold hover:bg-sky-500/25"><Wrench className="w-3.5 h-3.5" /> Enviar para teste</button><button onClick={() => updateReview(selectedReview.id, selectedReview.kind === 'bug' ? 'resolved' : 'rejected')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-rose-500/10 border border-rose-400/30 text-rose-200 text-xs font-bold hover:bg-rose-500/20"><ThumbsDown className="w-3.5 h-3.5" /> {selectedReview.kind === 'bug' ? 'Marcar resolvido' : 'Rejeitar'}</button><button onClick={() => updateReview(selectedReview.id, 'reopened')} className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-control bg-orange-500/10 border border-orange-400/30 text-orange-200 text-xs font-bold hover:bg-orange-500/20"><RotateCcw className="w-3.5 h-3.5" /> Reabrir</button></div></div>
          </aside>
        </div>
      )}
    </section>
  );
};

const toneMap: Record<string, string> = { amber: 'text-amber-300 bg-amber-500/10 border-amber-400/20', sky: 'text-sky-300 bg-sky-500/10 border-sky-400/20', rose: 'text-rose-300 bg-rose-500/10 border-rose-400/20', violet: 'text-violet-300 bg-violet-500/10 border-violet-400/20', emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20', slate: 'text-slate-300 bg-slate-500/10 border-slate-400/20' };

function MetricCard({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: React.ReactNode }) {
  return <div className="bg-slate-900/70 border border-slate-800 rounded-panel p-3"><div className={`w-7 h-7 rounded-control border flex items-center justify-center ${toneMap[tone] || toneMap.slate}`}>{icon}</div><p className="text-xl font-bold text-white mt-2">{value.toLocaleString('pt-BR')}</p><p className="text-[10px] text-slate-500 mt-0.5">{label}</p></div>;
}

function ControlPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-control border border-slate-800 bg-slate-950/60 p-2"><p className="text-[10px] text-slate-500">{label}</p><p className={`text-[11px] font-semibold mt-0.5 ${tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : tone === 'sky' ? 'text-sky-300' : 'text-violet-300'}`}>{value}</p></div>;
}

const ReviewCard: React.FC<{ review: QualityReview; onOpen: () => void }> = ({ review, onOpen }) => {
  return <button onClick={onOpen} className="w-full text-left bg-slate-900/70 border border-slate-800 hover:border-violet-500/40 rounded-card p-4 transition-colors group"><div className="flex items-start gap-3"><div className="w-8 h-8 rounded-control bg-slate-800 flex items-center justify-center flex-shrink-0">{kindIcon(review.kind)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABELS[review.kind]}</span><span className={`px-1.5 py-0.5 rounded-pill border text-[9px] font-bold ${STATUS_CLASSES[review.status]}`}>{STATUS_LABELS[review.status]}</span></div><h3 className="text-sm font-semibold text-white mt-1 group-hover:text-violet-200 transition-colors">{review.title}</h3><p className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">{review.description}</p><div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-slate-500"><span>{formatDate(review.created_at)}</span>{review.kind === 'ai_suggestion' && <span className="text-violet-300">Confiança {confidenceLabel(review.confidence)}</span>}{getDecision(review) && <span>Decisão: {getDecision(review)}</span>}</div></div><ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-violet-300 transition-colors flex-shrink-0" /></div></button>;
};

function ValueBlock({ label, value, tone }: { label: string; value: string; tone: 'rose' | 'emerald' }) {
  return <div className={`rounded-panel border p-3 ${tone === 'rose' ? 'bg-rose-500/5 border-rose-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}><p className="text-[10px] text-slate-500">{label}</p><p className={`text-xs mt-1 whitespace-pre-wrap break-words ${tone === 'rose' ? 'text-rose-200' : 'text-emerald-200'}`}>{value}</p></div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="p-10 text-center border border-dashed border-slate-800 rounded-card"><div className="w-10 h-10 mx-auto rounded-panel bg-slate-800/70 text-slate-500 flex items-center justify-center">{icon}</div><h3 className="text-sm font-semibold text-slate-300 mt-3">{title}</h3><p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{text}</p></div>;
}

function LoadingState() {
  return <div className="p-10 text-center text-xs text-slate-500"><RefreshCw className="w-5 h-5 mx-auto animate-spin text-violet-300" /><p className="mt-2">Carregando registros de qualidade...</p></div>;
}
