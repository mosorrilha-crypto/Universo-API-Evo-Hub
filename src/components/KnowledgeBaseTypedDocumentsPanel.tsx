/**
 * Direção visual: Operação Serena. Este painel torna estado, origem e impacto
 * de publicação explícitos, usando superfícies escuras, hierarquia compacta e
 * confirmação deliberada para evitar que conteúdo de rascunho seja assumido
 * como ativo pelo agente.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  HelpCircle,
  History,
  Layers,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  type KnowledgeBaseDocumentEvent,
  type KnowledgeBaseDocumentState,
  type KnowledgeBaseDocumentType,
  KNOWLEDGE_BASE_DOCUMENT_TYPES,
  listKnowledgeBaseDocumentEvents,
  listKnowledgeBaseDocumentStates,
  publishKnowledgeBaseDocument,
  saveKnowledgeBaseDocumentDraft,
} from '../lib/knowledgeBaseDocuments';

type PanelStatus = 'loading' | 'ready' | 'error';

const DOCUMENT_META: Record<KnowledgeBaseDocumentType, { label: string; description: string; icon: React.ReactNode; accent: string }> = {
  business_profile: { label: 'Perfil do negócio', description: 'Empresa, objetivo, posicionamento e localização.', icon: <Building2 className="h-4 w-4" />, accent: 'emerald' },
  brand_voice: { label: 'Voz da marca', description: 'Tom, idioma e estilo de conversa do agente.', icon: <MessageSquare className="h-4 w-4" />, accent: 'sky' },
  service_catalog: { label: 'Catálogo de serviços', description: 'Serviços, variações, preços, duração e mídia.', icon: <Layers className="h-4 w-4" />, accent: 'violet' },
  pricing_policies: { label: 'Preços e políticas', description: 'Regras comerciais, pagamentos e restrições.', icon: <BookOpen className="h-4 w-4" />, accent: 'amber' },
  opening_hours: { label: 'Horários', description: 'Reservado para a fonte estruturada de horários.', icon: <Clock3 className="h-4 w-4" />, accent: 'slate' },
  faq: { label: 'Perguntas frequentes', description: 'Dúvidas e respostas aprovadas para o agente.', icon: <HelpCircle className="h-4 w-4" />, accent: 'rose' },
  human_handoff_rules: { label: 'Encaminhamento humano', description: 'Reservado para regras estruturadas de escalonamento.', icon: <ShieldAlert className="h-4 w-4" />, accent: 'orange' },
  media_assets: { label: 'Mídias e primeiro contato', description: 'Anexos e sequência inicial de mídia.', icon: <Paperclip className="h-4 w-4" />, accent: 'cyan' },
};

const ACCENT_CLASSES: Record<string, { icon: string; border: string; selected: string; badge: string }> = {
  emerald: { icon: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20', border: 'border-emerald-400/35', selected: 'bg-emerald-500/10', badge: 'text-emerald-200 bg-emerald-500/10 border-emerald-400/20' },
  sky: { icon: 'text-sky-300 bg-sky-400/10 border-sky-400/20', border: 'border-sky-400/35', selected: 'bg-sky-500/10', badge: 'text-sky-200 bg-sky-500/10 border-sky-400/20' },
  violet: { icon: 'text-violet-300 bg-violet-400/10 border-violet-400/20', border: 'border-violet-400/35', selected: 'bg-violet-500/10', badge: 'text-violet-200 bg-violet-500/10 border-violet-400/20' },
  amber: { icon: 'text-amber-300 bg-amber-400/10 border-amber-400/20', border: 'border-amber-400/35', selected: 'bg-amber-500/10', badge: 'text-amber-200 bg-amber-500/10 border-amber-400/20' },
  slate: { icon: 'text-slate-300 bg-slate-400/10 border-slate-400/20', border: 'border-slate-400/35', selected: 'bg-slate-500/10', badge: 'text-slate-200 bg-slate-500/10 border-slate-400/20' },
  rose: { icon: 'text-rose-300 bg-rose-400/10 border-rose-400/20', border: 'border-rose-400/35', selected: 'bg-rose-500/10', badge: 'text-rose-200 bg-rose-500/10 border-rose-400/20' },
  orange: { icon: 'text-orange-300 bg-orange-400/10 border-orange-400/20', border: 'border-orange-400/35', selected: 'bg-orange-500/10', badge: 'text-orange-200 bg-orange-500/10 border-orange-400/20' },
  cyan: { icon: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20', border: 'border-cyan-400/35', selected: 'bg-cyan-500/10', badge: 'text-cyan-200 bg-cyan-500/10 border-cyan-400/20' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toEditorValue(data: Record<string, unknown> | undefined): string {
  return JSON.stringify(data || {}, null, 2);
}

function formatMoment(value: string | null | undefined): string {
  if (!value) return 'Ainda não publicado';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Data indisponível' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function getDataSummary(documentType: KnowledgeBaseDocumentType, data: Record<string, unknown> | undefined): string {
  if (!data || !Object.keys(data).length) return 'Sem conteúdo estruturado';
  if (documentType === 'service_catalog') return `${Array.isArray(data.products) ? data.products.length : 0} serviço(s) estruturado(s)`;
  if (documentType === 'faq') return `${Array.isArray(data.faqs) ? data.faqs.length : 0} pergunta(s) aprovada(s)`;
  if (documentType === 'pricing_policies') return `${Array.isArray(data.businessRules) ? data.businessRules.length : 0} regra(s) comercial(is)`;
  if (documentType === 'media_assets') return `${Array.isArray(data.documents) ? data.documents.length : 0} anexo(s) e ${Array.isArray(data.firstContactBlocks) ? data.firstContactBlocks.length : 0} bloco(s)`;
  return `${Object.keys(data).length} campo(s) estruturado(s)`;
}

function eventLabel(eventType: KnowledgeBaseDocumentEvent['eventType']): string {
  return eventType === 'published' ? 'Publicação' : eventType === 'draft_created' ? 'Rascunho criado' : 'Rascunho atualizado';
}

export function KnowledgeBaseTypedDocumentsPanel({ activeTenantId, isRuntimePublished = false }: { activeTenantId: string; isRuntimePublished?: boolean }) {
  const [status, setStatus] = useState<PanelStatus>('loading');
  const [states, setStates] = useState<KnowledgeBaseDocumentState[]>([]);
  const [selectedType, setSelectedType] = useState<KnowledgeBaseDocumentType>('business_profile');
  const [editorValue, setEditorValue] = useState('{}');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [events, setEvents] = useState<KnowledgeBaseDocumentEvent[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const loadStates = async () => {
    setStatus('loading');
    setRequestError(null);
    try {
      const nextStates = await listKnowledgeBaseDocumentStates();
      setStates(nextStates);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setRequestError(error instanceof Error ? error.message : 'Não foi possível carregar os documentos tipados.');
    }
  };

  useEffect(() => { void loadStates(); }, [activeTenantId]);

  const selectedState = useMemo(
    () => states.find((state) => state.documentType === selectedType) || { documentType: selectedType, published: null, draft: null },
    [selectedType, states],
  );
  const selectedMeta = DOCUMENT_META[selectedType];
  const selectedAccent = ACCENT_CLASSES[selectedMeta.accent];

  useEffect(() => {
    setEditorValue(toEditorValue(selectedState.draft?.data || selectedState.published?.data));
    setEditorError(null);
    setRequestError(null);
    setEvents([]);
    setShowHistory(false);
  }, [selectedState.draft?.id, selectedState.draft?.updatedAt, selectedState.published?.id, selectedState.published?.publishedAt, selectedType]);

  const parseEditorData = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(editorValue) as unknown;
      if (!isRecord(parsed)) throw new Error('O conteúdo precisa ser um objeto JSON entre { }.');
      setEditorError(null);
      return parsed;
    } catch (error) {
      setEditorError(error instanceof Error ? `Revise o JSON: ${error.message}` : 'Revise o conteúdo estruturado.');
      return null;
    }
  };

  const handleSaveDraft = async () => {
    if (isSaving) return;
    const data = parseEditorData();
    if (!data) return;
    setIsSaving(true);
    setRequestError(null);
    try {
      await saveKnowledgeBaseDocumentDraft(selectedType, data);
      await loadStates();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Não foi possível salvar o rascunho.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    setRequestError(null);
    try {
      await publishKnowledgeBaseDocument(selectedType);
      setShowPublishConfirm(false);
      await loadStates();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Não foi possível publicar este documento.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleToggleHistory = async () => {
    const nextVisible = !showHistory;
    setShowHistory(nextVisible);
    if (!nextVisible) return;
    setIsLoadingHistory(true);
    try {
      setEvents(await listKnowledgeBaseDocumentEvents(selectedType));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const publishedCount = states.filter((state) => state.published).length;
  const draftCount = states.filter((state) => state.draft).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_100%_0%,rgba(34,211,238,0.11),transparent_34%),#0f172a] shadow-md" aria-label="Documentos tipados da Base de Conhecimento">
      <header className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-200"><FileText className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-white">Documentos tipados e publicação</h3><span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">PR3</span></div>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-400">Organize a próxima versão por assunto, salve como rascunho e publique somente quando o conteúdo estiver revisado. {isRuntimePublished ? 'A cada nova resposta, o agente consulta somente os documentos publicados.' : 'O agente ainda continua usando a Base de Conhecimento legada nesta etapa.'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-2 py-1 text-[10px] font-semibold text-emerald-200">{publishedCount}/8 publicados</span>
          <span className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-2 py-1 text-[10px] font-semibold text-amber-100">{draftCount} rascunho(s)</span>
          <button type="button" onClick={() => void loadStates()} disabled={status === 'loading'} className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-[10px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${status === 'loading' ? 'animate-spin' : ''}`} />Atualizar</button>
        </div>
      </header>

      {status === 'loading' ? <div className="flex items-center gap-2 px-4 py-8 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-cyan-300" />Carregando versões publicadas e rascunhos…</div> : status === 'error' ? (
        <div className="m-4 flex flex-col gap-3 rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2 text-xs text-rose-100"><AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />{requestError}</div><button type="button" onClick={() => void loadStates()} className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-bold text-rose-100">Tentar novamente</button></div>
      ) : (
        <div className="grid min-h-[31rem] lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav className="border-b border-slate-800 bg-slate-950/45 p-2 lg:border-b-0 lg:border-r" aria-label="Tipos de documento">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
              {KNOWLEDGE_BASE_DOCUMENT_TYPES.map((documentType) => {
                const documentState = states.find((state) => state.documentType === documentType);
                const meta = DOCUMENT_META[documentType];
                const accent = ACCENT_CLASSES[meta.accent];
                const active = documentType === selectedType;
                return <button key={documentType} type="button" onClick={() => setSelectedType(documentType)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${active ? `${accent.selected} ${accent.border}` : 'border-transparent hover:bg-slate-900'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${accent.icon}`}>{meta.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold text-slate-200">{meta.label}</span><span className="mt-0.5 block text-[9px] text-slate-500">{documentState?.draft ? `Rascunho v${documentState.draft.version}` : documentState?.published ? `Publicado v${documentState.published.version}` : 'Sem versão'}</span></span>
                  {documentState?.draft ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" title="Há rascunho" /> : documentState?.published ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Publicado" /> : null}
                </button>;
              })}
            </div>
          </nav>

          <div className="min-w-0 p-4">
            <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${selectedAccent.icon}`}>{selectedMeta.icon}</span><div><h4 className="text-sm font-bold text-white">{selectedMeta.label}</h4><p className="mt-0.5 max-w-xl text-[11px] leading-5 text-slate-400">{selectedMeta.description}</p></div></div>
              <button type="button" onClick={() => void handleToggleHistory()} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-800"><History className="h-3.5 w-3.5 text-slate-400" />{showHistory ? 'Ocultar histórico' : 'Ver histórico'}{showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Em produção</span>{selectedState.published ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <span className="text-[10px] text-slate-500">Nenhuma</span>}</div><p className="mt-2 text-xs font-bold text-slate-100">{selectedState.published ? `Versão ${selectedState.published.version}` : 'Sem publicação tipada'}</p><p className="mt-1 text-[10px] text-slate-400">{selectedState.published ? `${getDataSummary(selectedType, selectedState.published.data)} · ${formatMoment(selectedState.published.publishedAt)}` : 'Crie um rascunho para preparar a primeira versão.'}</p></div>
              <div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-amber-200">Rascunho</span>{selectedState.draft ? <PencilMark /> : <span className="text-[10px] text-slate-500">Nenhum</span>}</div><p className="mt-2 text-xs font-bold text-slate-100">{selectedState.draft ? `Versão ${selectedState.draft.version}` : 'Nenhuma alteração pendente'}</p><p className="mt-1 text-[10px] text-slate-400">{selectedState.draft ? `${getDataSummary(selectedType, selectedState.draft.data)} · atualizado ${formatMoment(selectedState.draft.updatedAt)}` : 'Salvar abaixo cria um rascunho; nada muda no agente.'}</p></div>
            </div>

            {showHistory && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/65 p-3"><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500"><History className="h-3.5 w-3.5" />Trilha de auditoria</div>{isLoadingHistory ? <p className="flex items-center gap-2 py-2 text-[11px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando eventos…</p> : events.length ? <ol className="space-y-2">{events.map((event) => <li key={event.id} className="flex items-center justify-between gap-3 border-t border-slate-800/70 pt-2 first:border-t-0 first:pt-0"><span className="text-[11px] text-slate-300"><strong className="text-slate-100">{eventLabel(event.eventType)}</strong> · versão {event.version}</span><time className="shrink-0 text-[10px] text-slate-500">{formatMoment(event.createdAt)}</time></li>)}</ol> : <p className="text-[11px] text-slate-500">Nenhum evento registrado para este tipo.</p>}</div>}

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><label htmlFor="typed-document-editor" className="text-xs font-bold text-slate-200">Conteúdo estruturado do rascunho</label><p className="mt-0.5 text-[10px] leading-4 text-slate-500">O conteúdo publicado é carregado como ponto de partida. Preserve IDs, mídias, preços estruturados e variações quando editar o catálogo.</p></div><span className={`rounded-md border px-2 py-1 text-[9px] font-bold ${selectedAccent.badge}`}>{selectedState.draft ? 'EDITANDO RASCUNHO' : 'NOVA ALTERAÇÃO'}</span></div>
              <textarea id="typed-document-editor" value={editorValue} onChange={(event) => setEditorValue(event.target.value)} spellCheck={false} className="min-h-48 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200 outline-none transition-colors focus:border-cyan-400/60" aria-describedby="typed-document-editor-help" />
              <p id="typed-document-editor-help" className="mt-1.5 text-[10px] text-slate-500">A validação bloqueia campos fora do contrato e qualquer JSON inválido. Salvar cria apenas um rascunho; publicar exige confirmação.</p>
              {editorError && <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-100">{editorError}</p>}
              {requestError && <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-100">{requestError}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="max-w-md text-[10px] leading-4 text-slate-500"><strong className="font-semibold text-amber-200">Importante:</strong> {isRuntimePublished ? 'a publicação passa a valer para o agente na próxima resposta; rascunhos nunca entram no atendimento.' : 'a publicação cria a próxima versão tipada; nesta etapa ela ainda não altera o contexto real do agente.'}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void handleSaveDraft()} disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Salvar rascunho</button><button type="button" onClick={() => setShowPublishConfirm(true)} disabled={!selectedState.draft || isPublishing} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">{isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Publicar rascunho</button></div></div>
            </div>
          </div>
        </div>
      )}

      {showPublishConfirm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="publish-document-title"><div className="w-full max-w-md rounded-2xl border border-emerald-400/25 bg-slate-900 p-5 shadow-2xl"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-200"><AlertTriangle className="h-4 w-4" /></div><div><h4 id="publish-document-title" className="text-sm font-bold text-white">Publicar {selectedMeta.label}?</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">A versão {selectedState.draft?.version} substituirá a publicação tipada vigente e a anterior ficará arquivada no histórico. {isRuntimePublished ? 'A nova versão será usada pelo agente a partir da próxima resposta.' : 'O runtime do agente continua no fluxo legado até a PR4.'}</p></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowPublishConfirm(false)} disabled={isPublishing} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300">Cancelar</button><button type="button" onClick={() => void handlePublish()} disabled={isPublishing} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{isPublishing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Confirmar publicação</button></div></div></div>}
    </section>
  );
}

function PencilMark() {
  return <span className="rounded border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">PENDENTE</span>;
}
