import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, getTenantOverride } from '../../lib/apiClient';
import { formatCrmTaskDate } from '../../lib/crmPresentation';

type Task = { id: string; title: string; dueDate: string; completed: boolean; assignedOperator: string };
type Lead = { phone: string; assignedOperator?: string; tasks: Task[] };

/** Organização manual, persistida no CRM existente; nenhuma chamada de IA. */
export const ManualFollowUp: React.FC<{ phone: string }> = ({ phone }) => {
  const tenantOverride = useRef(getTenantOverride());
  const [loadVersion, setLoadVersion] = useState(0);
  const [lead, setLead] = useState<Lead | null>(null);
  const [responsible, setResponsible] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const readLead = async (): Promise<Lead> => {
    const response = await apiFetch('/api/crm/leads');
    if (!response.ok) throw new Error('Não foi possível carregar o acompanhamento.');
    const data = await response.json();
    return data.leads.find((item: Lead) => item.phone === phone) || { phone, tasks: [] };
  };
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    void readLead().then((value) => {
      if (active) { setLead(value); setResponsible(value.assignedOperator || ''); }
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [phone, loadVersion]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lead || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      // Releitura preserva tarefas criadas no CRM depois da abertura da ficha.
      const current = await readLead();
      if (getTenantOverride() !== tenantOverride.current) throw new Error('A empresa mudou. Abra a ficha novamente.');
      const patch: Record<string, unknown> = { assignedOperator: responsible.trim() || null };
      if (title.trim()) {
        patch.tasks = [...(current.tasks || []), {
          id: crypto.randomUUID(), title: title.trim(), dueDate: date,
          completed: false, assignedOperator: responsible.trim(),
        }];
      }
      const response = await apiFetch(`/api/crm/leads/${encodeURIComponent(phone)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o acompanhamento.');
      setLead(data.leadState); setTitle(''); setDate(''); setSaved(true);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100';
  return <section className="border-t border-slate-800/80 pt-4 space-y-3">
    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Acompanhamento manual</h4>
    <form onSubmit={save} className="space-y-2">
      <label className="block text-xs text-slate-400">Responsável
        <input className={inputClass} value={responsible} maxLength={120} disabled={busy || !lead} onChange={(e) => { setResponsible(e.target.value); setSaved(false); }} />
      </label>
      <label className="block text-xs text-slate-400">Retorno / tarefa
        <input className={inputClass} value={title} maxLength={240} disabled={busy || !lead} placeholder="Ex.: confirmar o serviço de interesse" onChange={(e) => { setTitle(e.target.value); setSaved(false); }} />
      </label>
      <label className="block text-xs text-slate-400">Data de retorno
        <input type="date" className={inputClass} value={date} required={Boolean(title.trim())} disabled={busy || !lead} onChange={(e) => { setDate(e.target.value); setSaved(false); }} />
      </label>
      <p className="text-[10px] text-slate-500">O retorno fica registrado como tarefa no CRM. Não envia mensagens automaticamente.</p>
      {error && <div role="alert" className="text-xs text-rose-300">{error}{!lead && <button type="button" className="ml-2 underline" onClick={() => setLoadVersion((value) => value + 1)}>Tentar novamente</button>}</div>}
      {saved && <p role="status" className="text-xs text-emerald-400">Acompanhamento salvo.</p>}
      <button disabled={busy || !lead} type="submit" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Carregando...' : 'Salvar acompanhamento'}</button>
    </form>
    {(lead?.tasks || []).filter((task) => !task.completed).map((task) => <div key={task.id} className="rounded-lg border border-slate-700 p-2 text-xs">
      <p className="text-slate-200 break-words">{task.title}</p>
      <p className="mt-1 text-slate-400">{task.dueDate ? formatCrmTaskDate(task.dueDate, 'pt-BR') : 'Sem prazo'}{task.assignedOperator ? ` · ${task.assignedOperator}` : ''}</p>
    </div>)}
  </section>;
};
