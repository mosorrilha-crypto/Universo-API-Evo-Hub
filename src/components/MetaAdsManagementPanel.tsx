import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Loader2, Pause, Play, Plus, ShieldCheck, WalletCards, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type Language = 'pt' | 'es';
type DeliveryStatus = 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';
type Objective = 'OUTCOME_ENGAGEMENT' | 'OUTCOME_LEADS' | 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC';
type Campaign = { id: string; name: string; deliveryStatus: DeliveryStatus };
type PendingAction = { kind: 'create' | 'status' | 'budget'; campaignId?: string; campaignName: string; nextStatus?: 'ACTIVE' | 'PAUSED'; dailyBudgetMinor?: number; summary: string };

interface MetaAdsManagementPanelProps {
  language: Language;
  managementConfigured: boolean;
  campaigns: Campaign[];
  currency: string;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const copy = {
  pt: {
    title: 'Central de Anúncios',
    description: 'Gerencie campanhas Click to WhatsApp pela interface do Universo. A Meta continua executando as operações; toda ação de escrita exige confirmação humana.',
    managementReady: 'Token de gerenciamento configurado',
    managementMissing: 'Configure um token separado com ads_management para habilitar as operações de escrita.',
    tokenHelp: 'O token atual de leitura não é suficiente para criar ou alterar campanhas. Para Click to WhatsApp, a Meta também exige permissões de página.',
    createTitle: 'Criar campanha pausada',
    nameLabel: 'Nome da campanha',
    namePlaceholder: 'Ex.: Combo Full Face — Luque — WhatsApp',
    objectiveLabel: 'Objetivo documentado pela Meta',
    objectiveLabels: { OUTCOME_ENGAGEMENT: 'Engajamento', OUTCOME_LEADS: 'Leads', OUTCOME_SALES: 'Vendas', OUTCOME_TRAFFIC: 'Tráfego' } as Record<Objective, string>,
    createButton: 'Preparar criação pausada',
    campaignList: 'Campanhas da conta',
    refreshHint: 'Atualize as métricas para carregar o estado mais recente da Meta.',
    pause: 'Pausar',
    activate: 'Ativar',
    budgetLabel: 'Novo orçamento diário (menor unidade da moeda)',
    budgetPlaceholder: 'Ex.: 100000',
    budgetButton: 'Preparar alteração',
    noAction: 'Sem ação disponível para este estado',
    confirmTitle: 'Confirmação necessária',
    confirmPrefix: 'Você está prestes a',
    confirmCreate: 'criar uma campanha na Meta. Ela nascerá PAUSED e não começará a veicular.',
    confirmStatus: 'alterar o status da campanha na Meta. Ativar pode iniciar gasto de mídia.',
    confirmBudget: 'alterar o orçamento diário na Meta. O valor será enviado em centavos/menor unidade e pode aumentar o gasto.',
    confirmButton: 'Confirmar no Meta',
    cancel: 'Cancelar',
    doneCreate: 'Campanha criada na Meta em estado PAUSED.',
    doneStatus: 'Status da campanha atualizado na Meta.',
    doneBudget: 'Orçamento diário atualizado na Meta.',
    requestError: 'Não foi possível executar a operação na Meta.',
    paused: 'Pausada', active: 'Ativa', pending_review: 'Em análise', disapproved: 'Reprovada', inactive: 'Inativa', unknown: 'Sem status',
    minorUnitNote: 'A API da Meta recebe o orçamento na menor unidade da moeda da conta. Confira a moeda e o valor antes de confirmar.',
  },
  es: {
    title: 'Central de Anuncios',
    description: 'Gestioná campañas Click to WhatsApp desde el Universo. Meta sigue ejecutando las operaciones; toda escritura exige confirmación humana.',
    managementReady: 'Token de gestión configurado',
    managementMissing: 'Configurá un token separado con ads_management para habilitar las operaciones de escritura.',
    tokenHelp: 'El token actual de lectura no alcanza para crear o cambiar campañas. Para Click to WhatsApp, Meta también exige permisos de página.',
    createTitle: 'Crear campaña pausada',
    nameLabel: 'Nombre de la campaña',
    namePlaceholder: 'Ej.: Combo Full Face — Luque — WhatsApp',
    objectiveLabel: 'Objetivo documentado por Meta',
    objectiveLabels: { OUTCOME_ENGAGEMENT: 'Interacción', OUTCOME_LEADS: 'Clientes potenciales', OUTCOME_SALES: 'Ventas', OUTCOME_TRAFFIC: 'Tráfico' } as Record<Objective, string>,
    createButton: 'Preparar creación pausada',
    campaignList: 'Campañas de la cuenta',
    refreshHint: 'Actualizá las métricas para cargar el estado más reciente de Meta.',
    pause: 'Pausar',
    activate: 'Activar',
    budgetLabel: 'Nuevo presupuesto diario (menor unidad de moneda)',
    budgetPlaceholder: 'Ej.: 100000',
    budgetButton: 'Preparar cambio',
    noAction: 'No hay acción disponible para este estado',
    confirmTitle: 'Confirmación necesaria',
    confirmPrefix: 'Estás por',
    confirmCreate: 'crear una campaña en Meta. Nacerá PAUSED y no comenzará a publicar.',
    confirmStatus: 'cambiar el estado de la campaña en Meta. Activarla puede iniciar gasto de medios.',
    confirmBudget: 'cambiar el presupuesto diario en Meta. El valor se enviará en centavos/menor unidad y puede aumentar el gasto.',
    confirmButton: 'Confirmar en Meta',
    cancel: 'Cancelar',
    doneCreate: 'Campaña creada en Meta en estado PAUSED.',
    doneStatus: 'Estado de la campaña actualizado en Meta.',
    doneBudget: 'Presupuesto diario actualizado en Meta.',
    requestError: 'No fue posible ejecutar la operación en Meta.',
    paused: 'Pausada', active: 'Activa', pending_review: 'En revisión', disapproved: 'Rechazada', inactive: 'Inactiva', unknown: 'Sin estado',
    minorUnitNote: 'La API de Meta recibe el presupuesto en la menor unidad de la moneda de la cuenta. Revisá moneda y valor antes de confirmar.',
  },
} as const;

function idempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `meta-${Date.now().toString(36)}-${random}`;
}

function statusClass(status: DeliveryStatus): string {
  if (status === 'active') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (status === 'paused' || status === 'inactive') return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  if (status === 'pending_review') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (status === 'disapproved') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return 'bg-slate-700 text-slate-400 border-slate-600';
}

export const MetaAdsManagementPanel: React.FC<MetaAdsManagementPanelProps> = ({ language, managementConfigured, campaigns, currency, onRefresh, onNotice, onError }) => {
  const text = copy[language];
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<Objective>('OUTCOME_ENGAGEMENT');
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const locale = language === 'es' ? 'es-PY' : 'pt-BR';

  const prepareCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setLocalError(language === 'pt' ? 'Informe um nome de campanha.' : 'Ingresá un nombre de campaña.');
      return;
    }
    setLocalError(null);
    setPendingAction({ kind: 'create', campaignName: name.trim(), summary: `${text.confirmPrefix} ${text.confirmCreate}` });
  };

  const prepareStatus = (campaign: Campaign, nextStatus: 'ACTIVE' | 'PAUSED') => {
    setLocalError(null);
    setPendingAction({ kind: 'status', campaignId: campaign.id, campaignName: campaign.name, nextStatus, summary: `${text.confirmPrefix} ${text.confirmStatus}` });
  };

  const prepareBudget = (campaign: Campaign) => {
    const parsed = Number(budgetDrafts[campaign.id]);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setLocalError(language === 'pt' ? 'Informe um orçamento inteiro maior que zero.' : 'Ingresá un presupuesto entero mayor que cero.');
      return;
    }
    setLocalError(null);
    setPendingAction({ kind: 'budget', campaignId: campaign.id, campaignName: campaign.name, dailyBudgetMinor: parsed, summary: `${text.confirmPrefix} ${text.confirmBudget}` });
  };

  const execute = async () => {
    if (!pendingAction) return;
    setIsWorking(true); setLocalError(null); setLocalNotice(null);
    try {
      let path = '/api/meta-ads/campaigns';
      let body: Record<string, unknown>;
      if (pendingAction.kind === 'create') {
        body = { name: pendingAction.campaignName, objective, specialAdCategories: [], confirmation: 'CONFIRMAR_NO_UNIVERSO' };
      } else if (pendingAction.kind === 'status') {
        path = `/api/meta-ads/campaigns/${encodeURIComponent(pendingAction.campaignId || '')}/status`;
        body = { status: pendingAction.nextStatus, confirmation: 'CONFIRMAR_NO_UNIVERSO' };
      } else {
        path = `/api/meta-ads/campaigns/${encodeURIComponent(pendingAction.campaignId || '')}/budget`;
        body = { dailyBudgetMinor: pendingAction.dailyBudgetMinor, confirmation: 'CONFIRMAR_NO_UNIVERSO' };
      }
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || text.requestError);
      const done = pendingAction.kind === 'create' ? text.doneCreate : pendingAction.kind === 'status' ? text.doneStatus : text.doneBudget;
      setLocalNotice(done); onNotice(done); setPendingAction(null); setName('');
      await onRefresh();
    } catch (requestError: any) {
      const message = requestError.message || text.requestError;
      setLocalError(message); onError(message);
    } finally { setIsWorking(false); }
  };

  return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="max-w-3xl"><div className="flex items-center gap-3"><span className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300"><WalletCards className="w-5 h-5" /></span><div><h3 className="text-lg font-bold text-white">{text.title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-400">{text.description}</p></div></div></div><div className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${managementConfigured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>{managementConfigured ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{managementConfigured ? text.managementReady : text.managementMissing}</div></div>
    {!managementConfigured && <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4 text-sm text-amber-100/90 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 text-amber-300" /><p>{text.tokenHelp}</p></div>}
    {localError && <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-sm text-rose-100 flex items-center justify-between gap-3"><span>{localError}</span><button type="button" onClick={() => setLocalError(null)} aria-label="Fechar"><X className="w-4 h-4" /></button></div>}
    {localNotice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm text-emerald-100 flex gap-3"><CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-300" /><span>{localNotice}</span></div>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <form onSubmit={prepareCreate} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-4"><div><h4 className="font-bold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-300" />{text.createTitle}</h4><p className="mt-1 text-xs leading-relaxed text-slate-500">A campanha será criada com `status=PAUSED`, conforme o fluxo documentado pela Meta.</p></div><div><label className="block mb-1.5 text-xs font-semibold text-slate-300">{text.nameLabel}</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder={text.namePlaceholder} maxLength={120} disabled={!managementConfigured || isWorking} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-indigo-500" /></div><div><label className="block mb-1.5 text-xs font-semibold text-slate-300">{text.objectiveLabel}</label><select value={objective} onChange={(event) => setObjective(event.target.value as Objective)} disabled={!managementConfigured || isWorking} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-indigo-500">{(['OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC'] as Objective[]).map((item) => <option key={item} value={item}>{text.objectiveLabels[item]} ({item})</option>)}</select></div><button type="submit" disabled={!managementConfigured || isWorking} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-all"><ShieldCheck className="w-4 h-4" />{text.createButton}</button></form>
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-4"><div><h4 className="font-bold text-white">{text.campaignList}</h4><p className="mt-1 text-xs leading-relaxed text-slate-500">{text.refreshHint}</p></div>{campaigns.length === 0 ? <p className="py-6 text-sm text-slate-500">{text.refreshHint}</p> : <div className="space-y-3">{campaigns.map((campaign) => { const isActive = campaign.deliveryStatus === 'active'; const isPaused = campaign.deliveryStatus === 'paused'; return <div key={campaign.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-100 truncate">{campaign.name}</p><p className="mt-1 text-[10px] font-mono text-slate-500">{campaign.id}</p></div><span className={`shrink-0 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${statusClass(campaign.deliveryStatus)}`}>{text[campaign.deliveryStatus]}</span></div><div className="flex flex-wrap gap-2">{isActive && <button type="button" onClick={() => prepareStatus(campaign, 'PAUSED')} disabled={!managementConfigured || isWorking} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold flex items-center gap-1.5"><Pause className="w-3.5 h-3.5" />{text.pause}</button>}{isPaused && <button type="button" onClick={() => prepareStatus(campaign, 'ACTIVE')} disabled={!managementConfigured || isWorking} className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5"><Play className="w-3.5 h-3.5" />{text.activate}</button>}{!isActive && !isPaused && <span className="text-xs text-slate-500">{text.noAction}</span>}</div><div className="pt-3 border-t border-slate-800 space-y-2"><label className="block text-[11px] font-semibold text-slate-400">{text.budgetLabel}</label><div className="flex flex-wrap gap-2"><input inputMode="numeric" value={budgetDrafts[campaign.id] || ''} onChange={(event) => setBudgetDrafts((current) => ({ ...current, [campaign.id]: event.target.value.replace(/\D/g, '') }))} placeholder={text.budgetPlaceholder} disabled={!managementConfigured || isWorking} className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500" /><button type="button" onClick={() => prepareBudget(campaign)} disabled={!managementConfigured || isWorking} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold flex items-center gap-1.5"><CircleDollarSign className="w-3.5 h-3.5" />{text.budgetButton}</button></div><p className="text-[10px] leading-relaxed text-slate-600">{text.minorUnitNote} {currency}</p></div></div>; })}</div>}</div>
    </div>
    {pendingAction && <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 space-y-3"><div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 shrink-0 text-indigo-300" /><div><h4 className="font-bold text-indigo-100">{text.confirmTitle}</h4><p className="mt-1 text-sm text-indigo-100/80">{pendingAction.summary}</p><p className="mt-2 text-xs text-indigo-200/60">{pendingAction.campaignName}</p></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void execute()} disabled={isWorking} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2">{isWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}{text.confirmButton}</button><button type="button" onClick={() => setPendingAction(null)} disabled={isWorking} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-semibold">{text.cancel}</button></div></div>}
  </section>;
};
