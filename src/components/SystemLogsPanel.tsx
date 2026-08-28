/**
 * Direção visual: Operação Serena — incidentes técnicos são auditáveis,
 * acionáveis e silenciosos; esta tela não dispara alertas nem ações automáticas.
 */
import React, { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, CheckCircle2, ClipboardCheck, Clock3, FileWarning, Layers3, Lightbulb, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { SystemIncidentInfo } from '../types';

interface SystemLogsPanelProps {
  incidents: SystemIncidentInfo[];
  isLoading?: boolean;
  onRefresh: () => void;
  onReview: (id: string) => void;
  onResolve: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}

const severityMeta = {
  critical: { label: 'Crítica', className: 'border-rose-500/35 bg-rose-500/10 text-rose-100' },
  high: { label: 'Alta', className: 'border-amber-500/35 bg-amber-500/10 text-amber-100' },
  medium: { label: 'Média', className: 'border-sky-500/35 bg-sky-500/10 text-sky-100' },
  low: { label: 'Baixa', className: 'border-slate-600 bg-slate-800 text-slate-200' },
} as const;

const categoryLabel: Record<SystemIncidentInfo['category'], string> = {
  runtime: 'Runtime', knowledge_base: 'Base de Conhecimento', authentication: 'Autenticação', catalog: 'Catálogo', media: 'Mídias', integration: 'Integração', availability: 'Disponibilidade',
};

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;
}

export const SystemLogsPanel: React.FC<SystemLogsPanelProps> = ({ incidents, isLoading, onRefresh, onReview, onResolve, onArchive, onRestore }) => {
  const [filter, setFilter] = useState<'open' | 'reviewed' | 'resolved' | 'archived' | 'urgent'>('open');
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const visible = useMemo(() => incidents.filter((incident) => filter === 'urgent'
    ? incident.status !== 'resolved' && incident.status !== 'archived' && ['critical', 'high'].includes(incident.severity)
    : incident.status === filter), [filter, incidents]);
  const counts = useMemo(() => ({
    open: incidents.filter((incident) => incident.status === 'open').length,
    reviewed: incidents.filter((incident) => incident.status === 'reviewed').length,
    resolved: incidents.filter((incident) => incident.status === 'resolved').length,
    archived: incidents.filter((incident) => incident.status === 'archived').length,
    urgent: incidents.filter((incident) => incident.status !== 'resolved' && incident.status !== 'archived' && ['critical', 'high'].includes(incident.severity)).length,
  }), [incidents]);

  return <div className="space-y-4">
    <header className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3"><span className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2.5 text-sky-200"><FileWarning className="h-5 w-5" /></span><div><h2 className="text-base font-bold text-white">Logs do Sistema</h2><p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-400">Audite erros técnicos por empresa, recorrência e sugestão de correção. Esta tela é silenciosa: não envia WhatsApp, push ou qualquer ação ao cliente.</p></div></div>
        <button type="button" onClick={onRefresh} disabled={isLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200 hover:border-sky-500/35 hover:text-sky-100 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Atualizar</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => setFilter('open')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === 'open' ? 'bg-sky-600 text-white' : 'border border-slate-700 bg-slate-950 text-slate-300'}`}>Novos ({counts.open})</button>
        <button onClick={() => setFilter('urgent')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === 'urgent' ? 'bg-rose-600 text-white' : 'border border-rose-500/25 bg-rose-500/5 text-rose-200'}`}>Revisar urgentes ({counts.urgent})</button>
        <button onClick={() => setFilter('reviewed')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === 'reviewed' ? 'bg-amber-600 text-white' : 'border border-slate-700 bg-slate-950 text-slate-300'}`}>Em revisão ({counts.reviewed})</button>
        <button onClick={() => setFilter('resolved')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === 'resolved' ? 'bg-emerald-600 text-white' : 'border border-slate-700 bg-slate-950 text-slate-300'}`}>Resolvidos ({counts.resolved})</button>
        <button onClick={() => setFilter('archived')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === 'archived' ? 'bg-slate-600 text-white' : 'border border-slate-700 bg-slate-950 text-slate-300'}`}>Arquivados ({counts.archived})</button>
      </div>
    </header>

    {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" /><p className="mt-3 text-sm font-bold text-slate-100">Nenhum incidente neste filtro.</p><p className="mt-1 text-xs text-slate-500">A operação continua normal. A página mostrará apenas exceções técnicas registradas.</p></div> : <div className="space-y-3">{visible.map((incident) => {
      const severity = severityMeta[incident.severity];
      const isOpen = incident.status === 'open';
      const isArchived = incident.status === 'archived';
      return <article key={incident.id} className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-md shadow-slate-950/15"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-white">{incident.title}</h3><span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${severity.className}`}>{severity.label}</span><span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{categoryLabel[incident.category]}</span>{incident.occurrenceCount > 1 && <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-200"><Layers3 className="h-3 w-3" /> {incident.occurrenceCount} ocorrências</span>}</div>
        {incident.detail && <p className="mt-2 text-xs leading-5 text-slate-400">{incident.detail}</p>}
        <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3"><p className="flex items-center gap-1.5 text-[11px] font-bold text-sky-100"><Lightbulb className="h-3.5 w-3.5 text-sky-300" /> Sugestão de correção</p><p className="mt-1 text-xs leading-5 text-slate-300">{incident.suggestedAction}</p><p className="mt-1.5 text-[10px] font-semibold text-sky-300">Revisar antes de aplicar. Nenhuma alteração é automática.</p></div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> Visto {timeAgo(incident.lastSeenAt)}</span><span>· primeira ocorrência {timeAgo(incident.firstSeenAt)}</span><span>· estado: {incident.status === 'open' ? 'novo' : incident.status === 'reviewed' ? 'em revisão' : incident.status === 'resolved' ? 'resolvido' : 'arquivado'}</span></div>
        {resolvingId === incident.id && <div className="mt-3 space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3"><label className="text-[11px] font-bold text-slate-200" htmlFor={`incident-note-${incident.id}`}>Registro da resolução</label><textarea id={`incident-note-${incident.id}`} value={noteById[incident.id] || ''} onChange={(event) => setNoteById((previous) => ({ ...previous, [incident.id]: event.target.value }))} placeholder="O que foi conferido ou corrigido?" className="min-h-20 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none" /><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { onResolve(incident.id, noteById[incident.id] || 'Resolvido após revisão administrativa.'); setResolvingId(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmar resolução</button><button type="button" onClick={() => setResolvingId(null)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700">Cancelar</button></div></div>}
      </div><div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">{isOpen && <button onClick={() => onReview(incident.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/20"><ClipboardCheck className="h-3.5 w-3.5" /> Marcar em revisão</button>}{!isArchived && incident.status !== 'resolved' && <button onClick={() => setResolvingId(resolvingId === incident.id ? null : incident.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Resolver</button>}{isArchived ? <button onClick={() => onRestore(incident.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white"><ArchiveRestore className="h-3.5 w-3.5" /> Restaurar</button> : <button onClick={() => onArchive(incident.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white"><Archive className="h-3.5 w-3.5" /> Arquivar</button>}</div></div></article>;
    })}</div>}
  </div>;
};
