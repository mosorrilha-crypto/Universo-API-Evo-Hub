import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, CircleOff, Clock3, Loader2, ShieldCheck, UsersRound, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type CatalogPlan = { id: string; key: string; name: string; version: number; status: string; description?: string | null };
type EffectiveEntitlement = {
  featureId: string;
  key: string;
  name: string;
  domain: string;
  kind: 'boolean' | 'quota' | 'configurable';
  enabled: boolean;
  limitValue: number | null;
  usage: number;
  remaining: number | null;
  source: 'plan' | 'override' | 'compatibility';
  override: { id: string; reason: string; expiresAt: string | null } | null;
};
type TenantEntitlements = {
  subscription: { id: string; status: string; startedAt: string; plan: { id: string; key: string; name: string; version: number } | null } | null;
  entitlements: EffectiveEntitlement[];
};
type FeatureDraft = { enabled: boolean; limitValue: string; expiresAt: string; reason: string };
type SaveNotice = { tone: 'success' | 'error'; text: string } | null;

interface TenantEntitlementsModalProps {
  tenant: { id: string; name: string };
  onClose: () => void;
}

const sourceLabel: Record<EffectiveEntitlement['source'], string> = {
  plan: 'Plano',
  override: 'Exceção',
  compatibility: 'Compatibilidade',
};

const domainLabel: Record<string, string> = {
  admin: 'Administração',
  ai: 'Inteligência artificial',
  booking: 'Agenda',
  catalog: 'Catálogo',
  channel: 'Canais',
  crm: 'CRM',
  quality: 'Qualidade',
  sales: 'Vendas',
};

function getDomainLabel(domain: string) {
  return domainLabel[domain] || domain.replace(/[._-]/g, ' ');
}

function isOperatorsFeature(entitlement: EffectiveEntitlement) {
  return entitlement.key === 'admin.tenant_operators';
}

function formatQuota(entitlement: EffectiveEntitlement) {
  if (entitlement.limitValue === null) return 'Sem limite';
  return `${entitlement.usage} de ${entitlement.limitValue} em uso`;
}

function toDraft(feature: EffectiveEntitlement): FeatureDraft {
  return {
    enabled: feature.enabled,
    limitValue: feature.limitValue === null ? '' : String(feature.limitValue),
    expiresAt: feature.override?.expiresAt ? feature.override.expiresAt.slice(0, 10) : '',
    reason: '',
  };
}

export function TenantEntitlementsModal({ tenant, onClose }: TenantEntitlementsModalProps) {
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [data, setData] = useState<TenantEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SaveNotice>(null);
  const [planId, setPlanId] = useState('');
  const [planReason, setPlanReason] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [savingFeatureId, setSavingFeatureId] = useState<string | null>(null);
  const [openFeatureId, setOpenFeatureId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FeatureDraft>>({});

  const features = useMemo(() => [...(data?.entitlements || [])].sort((left, right) => {
    if (isOperatorsFeature(left)) return -1;
    if (isOperatorsFeature(right)) return 1;
    return left.name.localeCompare(right.name, 'pt-BR');
  }), [data]);

  const groupedFeatures = useMemo(() => {
    const groups = new Map<string, EffectiveEntitlement[]>();
    for (const feature of features.filter((item) => !isOperatorsFeature(item))) {
      const group = groups.get(feature.domain) || [];
      group.push(feature);
      groups.set(feature.domain, group);
    }
    return [...groups.entries()].sort(([left], [right]) => getDomainLabel(left).localeCompare(getDomainLabel(right), 'pt-BR'));
  }, [features]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogResponse, tenantResponse] = await Promise.all([
        apiFetch('/api/admin/entitlements/catalog'),
        apiFetch(`/api/admin/tenants/${tenant.id}/entitlements`),
      ]);
      const [catalog, entitlements] = await Promise.all([catalogResponse.json(), tenantResponse.json()]);
      if (!catalogResponse.ok) throw new Error(catalog.error || `HTTP ${catalogResponse.status}`);
      if (!tenantResponse.ok) throw new Error(entitlements.error || `HTTP ${tenantResponse.status}`);
      setPlans((catalog.plans || []).filter((plan: CatalogPlan) => plan.status === 'active'));
      setData(entitlements);
      setPlanId(entitlements.subscription?.plan?.id || '');
      setDrafts(Object.fromEntries((entitlements.entitlements || []).map((feature: EffectiveEntitlement) => [feature.featureId, toDraft(feature)])));
    } catch (loadError: any) {
      setError(loadError.message || 'Falha ao carregar capacidades.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenant.id]);

  const updateDraft = (feature: EffectiveEntitlement, patch: Partial<FeatureDraft>) => {
    setDrafts((current) => ({ ...current, [feature.featureId]: { ...(current[feature.featureId] || toDraft(feature)), ...patch } }));
    setNotice(null);
  };

  const toggleFeatureCard = (feature: EffectiveEntitlement) => {
    const draft = drafts[feature.featureId] || toDraft(feature);
    updateDraft(feature, { enabled: !draft.enabled });
    setOpenFeatureId(feature.featureId);
  };

  const openFeatureSettings = (feature: EffectiveEntitlement) => {
    setOpenFeatureId((current) => current === feature.featureId ? null : feature.featureId);
    setNotice(null);
  };

  const discardDraft = (feature: EffectiveEntitlement) => {
    setDrafts((current) => ({ ...current, [feature.featureId]: toDraft(feature) }));
    setOpenFeatureId(null);
  };

  const saveSubscription = async (event: FormEvent) => {
    event.preventDefault();
    if (!planId || !planReason.trim()) return;
    setIsSavingPlan(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/subscription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, reason: planReason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setPlanReason('');
      await load();
      setNotice({ tone: 'success', text: 'Plano salvo. As regras efetivas foram recarregadas.' });
    } catch (saveError: any) {
      const message = saveError.message || 'Falha ao atualizar o plano.';
      setError(message);
      setNotice({ tone: 'error', text: message });
    } finally {
      setIsSavingPlan(false);
    }
  };

  const saveFeature = async (event: FormEvent, feature: EffectiveEntitlement) => {
    event.preventDefault();
    const draft = drafts[feature.featureId] || toDraft(feature);
    if (!draft.reason.trim()) return;
    const payload: Record<string, unknown> = { featureId: feature.featureId, enabled: draft.enabled, reason: draft.reason.trim() };
    if (feature.kind === 'quota') payload.limitValue = draft.limitValue.trim() ? Number(draft.limitValue) : null;
    if (draft.expiresAt) payload.expiresAt = new Date(`${draft.expiresAt}T23:59:59`).toISOString();

    setSavingFeatureId(feature.featureId);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      await load();
      setOpenFeatureId(null);
      setNotice({ tone: 'success', text: `${feature.name}: alteração salva e confirmada no servidor.` });
    } catch (saveError: any) {
      const message = saveError.message || 'Falha ao salvar o controle.';
      setError(message);
      setNotice({ tone: 'error', text: message });
    } finally {
      setSavingFeatureId(null);
    }
  };

  const restorePlanRule = async (feature: EffectiveEntitlement) => {
    const draft = drafts[feature.featureId] || toDraft(feature);
    if (!feature.override || !draft.reason.trim()) return;
    setSavingFeatureId(feature.featureId);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides/${feature.override.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: draft.reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      await load();
      setOpenFeatureId(null);
      setNotice({ tone: 'success', text: `${feature.name}: a regra do plano foi restaurada e confirmada no servidor.` });
    } catch (restoreError: any) {
      const message = restoreError.message || 'Falha ao restaurar a regra do plano.';
      setError(message);
      setNotice({ tone: 'error', text: message });
    } finally {
      setSavingFeatureId(null);
    }
  };

  const effectiveEnabledCount = features.filter((feature) => feature.enabled).length;
  const operatorFeature = features.find(isOperatorsFeature) || null;

  const renderFeatureCard = (feature: EffectiveEntitlement) => {
    const isOpen = openFeatureId === feature.featureId;
    const draft = drafts[feature.featureId] || toDraft(feature);
    const visibleEnabled = isOpen ? draft.enabled : feature.enabled;
    const saving = savingFeatureId === feature.featureId;
    const isChanged = draft.enabled !== feature.enabled
      || draft.limitValue !== (feature.limitValue === null ? '' : String(feature.limitValue))
      || draft.expiresAt !== (feature.override?.expiresAt ? feature.override.expiresAt.slice(0, 10) : '');

    return <article key={feature.featureId} className={`overflow-hidden rounded-2xl border transition ${visibleEnabled ? 'border-slate-700 bg-slate-900/80' : 'border-rose-500/50 bg-rose-950/20'}`}>
      <div className="flex items-center gap-3 p-3.5">
        <button
          type="button"
          role="switch"
          aria-checked={visibleEnabled}
          aria-label={`${visibleEnabled ? 'Bloquear' : 'Liberar'} ${feature.name}`}
          onClick={() => toggleFeatureCard(feature)}
          disabled={saving}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-wait disabled:opacity-50 ${visibleEnabled ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 focus-visible:ring-emerald-300' : 'bg-rose-600 text-white shadow-sm shadow-rose-950/60 hover:bg-rose-500 focus-visible:ring-rose-300'}`}
        >
          {visibleEnabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleOff className="h-3.5 w-3.5" />}
          {visibleEnabled ? 'Liberado' : 'Bloqueado'}
        </button>
        <button type="button" onClick={() => openFeatureSettings(feature)} className="min-w-0 flex-1 text-left focus:outline-none">
          <p className="truncate text-sm font-bold text-white">{feature.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{feature.kind === 'quota' ? formatQuota(feature) : sourceLabel[feature.source]}{feature.override ? ' · exceção ativa' : ''}</p>
        </button>
        <button type="button" onClick={() => openFeatureSettings(feature)} aria-label={`${isOpen ? 'Fechar' : 'Configurar'} ${feature.name}`} className={`rounded-lg border p-2 transition ${isOpen ? 'border-sky-400/70 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && <form onSubmit={(event) => saveFeature(event, feature)} className="border-t border-slate-700/80 bg-slate-950/35 p-3.5">
        <div className={`mb-3 rounded-xl border px-3 py-2 text-[11px] ${draft.enabled ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100' : 'border-rose-500/30 bg-rose-950/50 text-rose-100'}`}>
          <strong>{draft.enabled ? 'Liberar este recurso' : 'Bloquear este recurso'}</strong>
          <span className="ml-1">{isChanged ? 'Alteração pendente: informe o motivo e salve para torná-la efetiva.' : 'Revise os dados ou ajuste o estado antes de salvar.'}</span>
        </div>

        {isOperatorsFeature(feature) && <p className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/90">Este controle libera, bloqueia ou limita a capacidade de operadores do tenant. Ele não desativa individualmente uma pessoa já cadastrada.</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          {feature.kind === 'quota' && <label className="block text-[10px] font-semibold text-slate-400">Limite
            <input min="0" step="1" type="number" value={draft.limitValue} onChange={(event) => updateDraft(feature, { limitValue: event.target.value })} placeholder="Herdar plano" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none" />
            <span className="mt-1 block font-normal text-slate-500">Em uso: {feature.usage}. Deixe em branco para herdar o plano.</span>
          </label>}
          <label className="block text-[10px] font-semibold text-slate-400">Expira em <span className="font-normal text-slate-500">(opcional)</span>
            <input type="date" value={draft.expiresAt} onChange={(event) => updateDraft(feature, { expiresAt: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none" />
          </label>
        </div>
        <label className="mt-3 block text-[10px] font-semibold text-slate-400">Motivo obrigatório para salvar
          <textarea value={draft.reason} onChange={(event) => updateDraft(feature, { reason: event.target.value })} rows={2} placeholder={draft.enabled ? 'Ex.: liberação comercial aprovada' : 'Ex.: acesso suspenso até regularização'} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none" />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !draft.reason.trim()} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${draft.enabled ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-700 hover:bg-rose-600'}`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleOff className="h-3.5 w-3.5" />}
            {saving ? 'Salvando...' : 'Salvar alteração'}
          </button>
          <button type="button" onClick={() => discardDraft(feature)} disabled={saving} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
          {feature.override && <button type="button" onClick={() => restorePlanRule(feature)} disabled={saving || !draft.reason.trim()} className="rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2.5 text-xs font-bold text-sky-200 transition hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-50">Usar plano</button>}
        </div>
        {feature.override && <p className="mt-2 flex items-center gap-1 text-[10px] text-sky-200"><Clock3 className="h-3.5 w-3.5" /> Exceção ativa {feature.override.expiresAt ? `até ${new Date(feature.override.expiresAt).toLocaleDateString('pt-BR')}` : 'sem expiração'}.</p>}
      </form>}
    </article>;
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" onClick={() => !savingFeatureId && !isSavingPlan && onClose()}>
    <div className="flex max-h-[92svh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-5 py-4 sm:px-6">
        <div><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Central de controles</p></div><h2 className="mt-1 text-lg font-black text-white">{tenant.name}</h2><p className="mt-1 max-w-2xl text-xs text-slate-400">Use a chave de cada card para preparar a liberação ou o bloqueio. A alteração só vale depois de salvar com motivo.</p></div>
        <button type="button" onClick={onClose} disabled={Boolean(savingFeatureId) || isSavingPlan} aria-label="Fechar central de controles" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {notice && <div role="status" className={`mb-4 rounded-xl border px-3 py-2 text-xs ${notice.tone === 'success' ? 'border-emerald-700 bg-emerald-950/45 text-emerald-100' : 'border-rose-800 bg-rose-950/50 text-rose-200'}`}>{notice.text}</div>}
        {loading || !data ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando controles do tenant...</div> : <div className="space-y-4">
          <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Contrato atual</p><p className="mt-1 text-base font-bold text-white">{data.subscription?.plan ? `${data.subscription.plan.name} · v${data.subscription.plan.version}` : 'Compatibilidade sem assinatura persistida'}</p><p className="mt-1 text-xs text-slate-400">{data.subscription ? `Status: ${data.subscription.status}` : 'A compatibilidade preserva o acesso atual até a assinatura estar disponível.'}</p>
              <form onSubmit={saveSubscription} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.15fr_auto] sm:items-end"><label className="text-[10px] font-semibold text-slate-400">Plano<select value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100"><option value="">Selecionar plano</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · v{plan.version}</option>)}</select></label><label className="text-[10px] font-semibold text-slate-400">Motivo obrigatório<input value={planReason} onChange={(event) => setPlanReason(event.target.value)} placeholder="Ex.: contrato renovado" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" /></label><button type="submit" disabled={isSavingPlan || !planId || !planReason.trim()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{isSavingPlan ? 'Salvando...' : 'Salvar plano'}</button></form>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Liberados</p><p className="mt-1 text-2xl font-black text-emerald-300">{effectiveEnabledCount}<span className="text-sm font-semibold text-slate-500">/{features.length}</span></p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Bloqueados</p><p className="mt-1 text-2xl font-black text-rose-300">{features.length - effectiveEnabledCount}</p></div><p className="col-span-2 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-400">O estado verde ou vermelho de cada chave reflete a regra efetiva salva. A caixa aberta abaixo do card mostra alterações ainda pendentes.</p></div>
          </section>

          <section className="space-y-4"><div><h3 className="text-sm font-bold text-white">Recursos e capacidade</h3><p className="mt-0.5 text-[11px] text-slate-400">Cada funcionalidade é independente: use sua chave e configure sem sair do próprio card.</p></div>
            {operatorFeature && <div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Operadores</p>{renderFeatureCard(operatorFeature)}</div>}
            {groupedFeatures.map(([domain, domainFeatures]) => <div key={domain}><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{getDomainLabel(domain)}</p><div className="grid gap-2 lg:grid-cols-2">{domainFeatures.map(renderFeatureCard)}</div></div>)}
          </section>

          <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] leading-relaxed text-slate-500"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Cada salvamento cria uma exceção auditável. RBAC, RLS e os guardas de domínio continuam aplicados independentemente deste painel.</p>
        </div>}
      </div>
    </div>
  </div>;
}
