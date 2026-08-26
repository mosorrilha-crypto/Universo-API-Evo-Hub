import React, { useMemo, useState } from 'react';
import { EscalationInfo } from '../types';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe2,
  Layers3,
  MessageCircle,
  MessageCircleReply,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TimerReset,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';

interface EscalationsPanelProps {
  escalations: EscalationInfo[];
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onGoToConversation?: (phone: string) => void;
  onAssignSelf?: (id: string) => void;
  onSubmitOperatorReply?: (id: string, reply: string) => void;
  /** Gera uma proposta para revisão humana; nunca envia mensagem ao cliente. */
  onGenerateReplySuggestion?: (id: string) => Promise<EscalationInfo | null>;
  /** Registra edição, cópia ou descarte sem salvar o texto no evento de auditoria. */
  onReplySuggestionFeedback?: (id: string, suggestion: string, status: 'edited' | 'copied' | 'discarded') => Promise<EscalationInfo | null>;
  onResolvePayment?: (id: string, phone: string, status: 'verified' | 'rejected', reply?: string) => void;
  /** Envia o texto aprovado (rascunho bloqueado ou sugestão, como está ou editado) direto pro cliente e fecha o caso. */
  onApproveAndSend?: (id: string, phone: string, text: string) => Promise<boolean>;
  /** Traz um caso arquivado de volta pra fila de pendentes. */
  onRestore?: (id: string) => void;
}

function toWaMeLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function formatRemaining(expiresAtIso: string, expiredLabel = 'vencido'): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const label = hours > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}` : `${minutes}min`;
  return diffMs > 0 ? `em ${label}` : `${expiredLabel} há ${label}`;
}

const priorityMeta = {
  critical: { label: 'Crítica', className: 'border-rose-500/30 bg-rose-500/10 text-rose-200' },
  high: { label: 'Alta', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
  medium: { label: 'Média', className: 'border-sky-500/30 bg-sky-500/10 text-sky-200' },
  low: { label: 'Baixa', className: 'border-slate-600 bg-slate-800 text-slate-300' },
} as const;

function statusLabel(status?: EscalationInfo['status']): string {
  return ({ open: 'Sem responsável', assigned: 'Em atendimento', awaiting_customer: 'Aguardando cliente', resolved: 'Resolvido', archived: 'Arquivado' } as const)[status || 'open'];
}

export const EscalationsPanel: React.FC<EscalationsPanelProps> = ({
  escalations,
  onResolve,
  onDelete,
  onGoToConversation,
  onAssignSelf,
  onSubmitOperatorReply,
  onGenerateReplySuggestion,
  onReplySuggestionFeedback,
  onResolvePayment,
  onApproveAndSend,
  onRestore,
}) => {
  const [filter, setFilter] = useState<'pending' | 'resolved' | 'archived'>('pending');
  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [openSuggestionId, setOpenSuggestionId] = useState<string | null>(null);
  const [suggestionDraftById, setSuggestionDraftById] = useState<Record<string, string>>({});
  const [suggestionBusyId, setSuggestionBusyId] = useState<string | null>(null);
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);

  const { pending, resolved, archived, visible, overdue } = useMemo(() => {
    const current = escalations.filter((e) => e.status !== 'archived');
    const pendingItems = current.filter((e) => !e.resolved && e.status !== 'resolved');
    const resolvedItems = current.filter((e) => e.resolved || e.status === 'resolved');
    const archivedItems = escalations.filter((e) => e.status === 'archived');
    return {
      pending: pendingItems,
      resolved: resolvedItems,
      archived: archivedItems,
      visible: filter === 'pending' ? pendingItems : filter === 'resolved' ? resolvedItems : archivedItems,
      overdue: pendingItems.filter((e) => e.dueAt && new Date(e.dueAt).getTime() < Date.now()).length,
    };
  }, [escalations, filter]);

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300"><AlertTriangle className="h-4 w-4" /></span>
              <div>
                <h2 className="text-base font-bold text-white">Escalonamentos</h2>
                <p className="mt-0.5 text-xs text-slate-400">Fila completa ordenada por estado, prioridade e prazo. Cada caso preserva responsável e histórico de decisão.</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 font-semibold text-slate-300">{pending.length} pendente{pending.length === 1 ? '' : 's'}</span>
              {overdue > 0 && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 font-semibold text-rose-200">{overdue} com SLA vencido</span>}
              <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-400">Exibindo {visible.length} de {filter === 'pending' ? pending.length : resolved.length}</span>
            </div>
          </div>
          <div className="flex rounded-xl border border-slate-700 bg-slate-950 p-1">
            <button onClick={() => setFilter('pending')} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${filter === 'pending' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>Pendentes ({pending.length})</button>
            <button onClick={() => setFilter('resolved')} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${filter === 'resolved' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>Resolvidos ({resolved.length})</button>
            <button onClick={() => setFilter('archived')} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${filter === 'archived' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>Arquivados ({archived.length})</button>
          </div>
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" />
          <p className="mt-3 text-sm font-bold text-slate-100">{filter === 'pending' ? 'Nenhum escalonamento pendente.' : filter === 'resolved' ? 'Nenhum escalonamento resolvido ainda.' : 'Nenhum escalonamento arquivado.'}</p>
          <p className="mt-1 text-xs text-slate-500">A fila será atualizada quando houver uma nova decisão humana necessária.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((e) => {
            const priority = priorityMeta[e.priority || 'medium'];
            const isPending = !e.resolved && e.status !== 'resolved' && e.status !== 'archived';
            const isArchived = e.status === 'archived';
            const isOverdue = Boolean(isPending && e.dueAt && new Date(e.dueAt).getTime() < Date.now());
            return (
              <article key={e.id} className={`rounded-2xl border bg-slate-900/90 p-4 shadow-md shadow-slate-950/15 ${isOverdue ? 'border-rose-500/35' : 'border-slate-800'}`}>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-white">{e.contactName || e.phone}</h3>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priority.className}`}>{priority.label}</span>
                      <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{statusLabel(e.status)}</span>
                      {(e.occurrenceCount || 1) > 1 && <span title="Ocorrências reunidas no mesmo caso" className="inline-flex items-center gap-1 rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-200"><Layers3 className="h-3 w-3" /> {e.occurrenceCount} ocorrências</span>}
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-amber-200">{e.reason}</p>
                    {e.lastMessage && <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>“{e.lastMessage}”</span></p>}
                    {e.blockedDraft && (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs leading-relaxed text-rose-100/90">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
                        <span><span className="font-bold">Rascunho da IA (bloqueado):</span> “{e.blockedDraft}”</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-slate-500"><Clock className="h-3 w-3" /> Criado {timeAgo(e.createdAt)}</span>
                      {isPending && e.dueAt && <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${isOverdue ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}><AlertTriangle className="h-3 w-3" /> SLA {formatRemaining(e.dueAt)}</span>}
                      {isPending && e.serviceWindowExpiresAt && <span title="Janela de atendimento do WhatsApp" className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${e.withinServiceWindow ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}><TimerReset className="h-3 w-3" /> Janela {formatRemaining(e.serviceWindowExpiresAt, 'fechada')}</span>}
                      {e.assignedOperatorId ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200"><UserRoundCheck className="h-3 w-3" /> Responsável atribuído</span> : isPending ? <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-400"><UserRoundCheck className="h-3 w-3" /> Sem responsável</span> : null}
                      <span className="inline-flex items-center gap-1 text-slate-500"><Phone className="h-3 w-3" /> {e.phone}</span>
                      <span className="inline-flex items-center gap-1 text-slate-500"><Globe2 className="h-3 w-3" /> {e.country}</span>
                    </div>
                    {e.operatorReply && !e.operatorReplyConsumedAt && <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100"><span className="font-bold">Orientação pendente:</span> {e.operatorReply}{e.guidanceExpiresAt && <span className="ml-1 text-amber-300">· expira {formatRemaining(e.guidanceExpiresAt)}</span>}</div>}
                    {e.resolutionNote && <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-100"><span className="font-bold">Decisão:</span> {e.resolutionNote}</div>}
                    {openReplyId === e.id && (
                      <div className="mt-3 space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
                        <AutoResizeTextarea value={replyDraftById[e.id] || ''} onChange={(event) => setReplyDraftById((prev) => ({ ...prev, [e.id]: event.target.value }))} placeholder={e.kind === 'payment_proof' ? 'Explique a pendência do comprovante para a cliente.' : 'Descreva a orientação segura para a IA.'} minRows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none" />
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => { const reply = (replyDraftById[e.id] || '').trim(); if (!reply) return; if (e.kind === 'payment_proof') onResolvePayment?.(e.id, e.phone, 'rejected', reply); else onSubmitOperatorReply?.(e.id, reply); setReplyDraftById((prev) => ({ ...prev, [e.id]: '' })); setOpenReplyId(null); }} disabled={!(replyDraftById[e.id] || '').trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Enviar orientação</button>
                          <button onClick={() => setOpenReplyId(null)} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">Cancelar</button>
                        </div>
                      </div>
                    )}
                    {openSuggestionId === e.id && onGenerateReplySuggestion && onReplySuggestionFeedback && (
                      <div className="mt-3 space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div><p className="flex items-center gap-1.5 text-xs font-bold text-sky-100"><Sparkles className="h-3.5 w-3.5" /> {e.blockedDraft ? 'Rascunho bloqueado' : 'Sugestão supervisionada'}</p><p className="mt-0.5 text-[10px] text-slate-400">Nada é enviado automaticamente. Revise, edite, copie ou descarte.</p></div>
                          <button type="button" disabled={suggestionBusyId === e.id} onClick={async () => { setSuggestionBusyId(e.id); try { const updated = await onGenerateReplySuggestion(e.id); if (updated) setSuggestionDraftById((previous) => ({ ...previous, [e.id]: updated.suggestedReply || '' })); } finally { setSuggestionBusyId(null); } }} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[10px] font-bold text-sky-100 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${suggestionBusyId === e.id ? 'animate-spin' : ''}`} /> Gerar</button>
                        </div>
                        {e.blockedDraft && e.suggestedReply && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setSuggestionDraftById((previous) => ({ ...previous, [e.id]: e.blockedDraft || '' }))} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-200 hover:bg-rose-500/20">Usar rascunho bloqueado</button>
                            <button type="button" onClick={() => setSuggestionDraftById((previous) => ({ ...previous, [e.id]: e.suggestedReply || '' }))} className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/20">Usar sugestão da IA</button>
                          </div>
                        )}
                        <AutoResizeTextarea value={suggestionDraftById[e.id] ?? e.blockedDraft ?? e.suggestedReply ?? ''} onChange={(event) => setSuggestionDraftById((previous) => ({ ...previous, [e.id]: event.target.value }))} placeholder="A sugestão aparecerá aqui para sua revisão." minRows={3} maxLength={900} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none" />
                        {onApproveAndSend && e.serviceWindowExpiresAt && !e.withinServiceWindow && (
                          <p className="text-[10px] font-semibold text-amber-300">Janela de 24h fechada — não dá pra mandar texto livre agora. Use "Orientar IA" (retoma quando o cliente escrever de novo) ou o template de reengajamento.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {onApproveAndSend && (
                            <button type="button" disabled={approveBusyId === e.id || suggestionBusyId === e.id || !(suggestionDraftById[e.id] ?? e.blockedDraft ?? e.suggestedReply ?? '').trim() || (Boolean(e.serviceWindowExpiresAt) && !e.withinServiceWindow)} onClick={async () => { const text = (suggestionDraftById[e.id] ?? e.blockedDraft ?? e.suggestedReply ?? '').trim(); if (!text) return; setApproveBusyId(e.id); try { const sent = await onApproveAndSend(e.id, e.phone, text); if (sent) { setSuggestionDraftById((previous) => ({ ...previous, [e.id]: '' })); setOpenSuggestionId(null); } } finally { setApproveBusyId(null); } }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-3 w-3" /> {approveBusyId === e.id ? 'Enviando…' : 'Aprovar e enviar'}</button>
                          )}
                          <button type="button" disabled={suggestionBusyId === e.id || !(suggestionDraftById[e.id] ?? e.suggestedReply ?? '').trim()} onClick={async () => { const suggestion = (suggestionDraftById[e.id] ?? e.suggestedReply ?? '').trim(); if (!suggestion) return; setSuggestionBusyId(e.id); try { const updated = await onReplySuggestionFeedback(e.id, suggestion, 'edited'); if (updated) setSuggestionDraftById((previous) => ({ ...previous, [e.id]: updated.suggestedReply || suggestion })); } finally { setSuggestionBusyId(null); } }} className="rounded-lg bg-slate-800 px-3 py-1.5 text-[10px] font-bold text-slate-100 disabled:opacity-40">Salvar edição</button>
                          <button type="button" disabled={suggestionBusyId === e.id || !(suggestionDraftById[e.id] ?? e.suggestedReply ?? '').trim()} onClick={async () => { const suggestion = (suggestionDraftById[e.id] ?? e.suggestedReply ?? '').trim(); if (!suggestion) return; setSuggestionBusyId(e.id); try { await navigator.clipboard?.writeText(suggestion); await onReplySuggestionFeedback(e.id, suggestion, 'copied'); } finally { setSuggestionBusyId(null); } }} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-40"><Copy className="h-3 w-3" /> Copiar</button>
                          <button type="button" disabled={suggestionBusyId === e.id} onClick={async () => { setSuggestionBusyId(e.id); try { await onReplySuggestionFeedback(e.id, '', 'discarded'); setSuggestionDraftById((previous) => ({ ...previous, [e.id]: '' })); setOpenSuggestionId(null); } finally { setSuggestionBusyId(null); } }} className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-rose-300 disabled:opacity-40">Descartar</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
                    {onGoToConversation && <button onClick={() => onGoToConversation(e.phone)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/35 hover:text-emerald-200"><MessageCircle className="h-3.5 w-3.5" /> Conversa</button>}
                    <a href={toWaMeLink(e.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/35 hover:text-emerald-200"><ExternalLink className="h-3.5 w-3.5" /> WhatsApp</a>
                    {isPending && !e.assignedOperatorId && onAssignSelf && <button onClick={() => onAssignSelf(e.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/20"><UserRoundCheck className="h-3.5 w-3.5" /> Assumir</button>}
                    {isPending && e.kind === 'payment_proof' && onResolvePayment ? <>
                      <button onClick={() => onResolvePayment(e.id, e.phone, 'verified')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmar pagamento</button>
                      <button onClick={() => setOpenReplyId(openReplyId === e.id ? null : e.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/20"><XCircle className="h-3.5 w-3.5" /> Rejeitar</button>
                    </> : isPending ? <>
                      {onGenerateReplySuggestion && onReplySuggestionFeedback && <button onClick={async () => { const shouldOpen = openSuggestionId !== e.id; setOpenSuggestionId(shouldOpen ? e.id : null); if (!shouldOpen || e.suggestedReply || e.blockedDraft) return; setSuggestionBusyId(e.id); try { const updated = await onGenerateReplySuggestion(e.id); if (updated) setSuggestionDraftById((previous) => ({ ...previous, [e.id]: updated.suggestedReply || '' })); } finally { setSuggestionBusyId(null); } }} disabled={suggestionBusyId === e.id} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"><Sparkles className="h-3.5 w-3.5" /> {e.blockedDraft ? 'Revisar rascunho' : e.suggestedReply ? 'Revisar sugestão' : 'Gerar sugestão'}</button>}
                      {onSubmitOperatorReply && <button onClick={() => setOpenReplyId(openReplyId === e.id ? null : e.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/20"><MessageCircleReply className="h-3.5 w-3.5" /> Orientar IA</button>}
                      <button onClick={() => onResolve(e.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Resolver</button>
                    </> : null}
                    {isArchived && onRestore ? (
                      <button onClick={() => onRestore(e.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-emerald-500/35 hover:text-emerald-200"><ArchiveRestore className="h-3.5 w-3.5" /> Restaurar</button>
                    ) : !isArchived ? (
                      <button onClick={() => onDelete(e.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"><Archive className="h-3.5 w-3.5" /> Arquivar</button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
