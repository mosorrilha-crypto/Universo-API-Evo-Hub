import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleOff, Clock3, Loader2, ShieldCheck, SlidersHorizontal, UsersRound, X, Zap } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type CatalogFeature = { id: string; key: string; name: string; domain: string; kind: 'boolean' | 'quota' | 'configurable'; status: string };
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

export function TenantEntitlementsModal({ tenant, onClose }: TenantEntitlementsModalProps) {
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [data, setData] = useState<TenantEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planId, setPlanId] = useState('');
  const [planReason, setPlanReason] = useState('');
  const [selectedFeatureId, setSelectedFeatureId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [limitValue, setLimitValue] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');

  const features = useMemo(() => {
    return [...(data?.entitlements || [])].sort((left, right) => {
      if (isOperatorsFeature(left)) return -1;
      if (isOperatorsFeature(right)) return 1;
      return left.name.localeCompare(right.name, 'pt-BR');
    });
  }, [data]);

  const selected = useMemo(
    () => features.find((feature) => feature.featureId === selectedFeatureId) || null,
    [features, selectedFeatureId],
  );

  const groupedFeatures = useMemo(() => {
    const groups = new Map<string, EffectiveEntitlement[]>();
    for (const feature of features.filter((item) => !isOperatorsFeature(item))) {
      const current = groups.get(feature.domain) || [];
      current.push(feature);
      groups.set(feature.domain, current);
    }
    return [...groups.entries()].sort(([left], [right]) => getDomainLabel(left).localeCompare(getDomainLabel(right), 'pt-BR'));
  }, [features]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, tenantRes] = await Promise.all([
        apiFetch('/api/admin/entitlements/catalog'),
        apiFetch(`/api/admin/tenants/${tenant.id}/entitlements`),
      ]);
      const [catalog, entitlements] = await Promise.all([catalogRes.json(), tenantRes.json()]);
      if (!catalogRes.ok) throw new Error(catalog.error || `HTTP ${catalogRes.status}`);
      if (!tenantRes.ok) throw new Error(entitlements.error || `HTTP ${tenantRes.status}`);
      setPlans((catalog.plans || []).filter((plan: CatalogPlan) => plan.status === 'active'));
      setData(entitlements);
      setPlanId(entitlements.subscription?.plan?.id || '');
    } catch (loadError: any) {
      setError(loadError.message || 'Falha ao carregar capacidades.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenant.id]);

  useEffect(() => {
    if (!features.length) return;
    setSelectedFeatureId((current) => features.some((feature) => feature.featureId === current) ? current : features[0].featureId);
  }, [features]);

  useEffect(() => {
    if (!selected) return;
    setEnabled(selected.enabled);
    setLimitValue(selected.limitValue === null ? '' : String(selected.limitValue));
    setExpiresAt(selected.override?.expiresAt ? selected.override.expiresAt.slice(0, 10) : '');
    setReason('');
  }, [selectedFeatureId, selected?.featureId, selected?.enabled, selected?.limitValue, selected?.override?.id]);

  const saveSubscription = async (event: FormEvent) => {
    event.preventDefault();
    if (!planId || !planReason.trim()) return;
    setSaving(true);
    setError(null);
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
    } catch (saveError: any) {
      setError(saveError.message || 'Falha ao atualizar o plano.');
    } finally {
      setSaving(false);
    }
  };

  const saveResourceControl = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    const payload: Record<string, unknown> = {
      featureId: selected.featureId,
      enabled,
      reason: reason.trim(),
    };
    if (selected.kind === 'quota') payload.limitValue = limitValue.trim() ? Number(limitValue) : null;
    if (expiresAt) payload.expiresAt = new Date(`${expiresAt}T23:59:59`).toISOString();

    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReason('');
      await load();
    } catch (saveError: any) {
      setError(saveError.message || 'Falha ao aplicar o controle do recurso.');
    } finally {
      setSaving(false);
    }
  };

  const usePlanRule = async () => {
    if (!selected?.override || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides/${selected.override.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReason('');
      await load();
    } catch (revokeError: any) {
      setError(revokeError.message || 'Falha ao restaurar a regra do plano.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveEnabledCount = features.filter((feature) => feature.enabled).length;
  const operatorFeature = features.find(isOperatorsFeature) || null;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" onClick={() => !saving && onClose()}>
    <div className="flex max-h-[92svh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-5 py-4 sm:px-6">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Central de controles</p></div>
          <h2 className="mt-1 text-lg font-black text-white">{tenant.name}</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">Libere, bloqueie ou limite recursos em uma única tela. Toda mudança exige motivo e fica registrada.</p>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar central de controles" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {loading || !data ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando controles do tenant...</div> : <div className="space-y-4">
          <section className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Contrato atual</p>
              <p className="mt-1 text-base font-bold text-white">{data.subscription?.plan ? `${data.subscription.plan.name} · v${data.subscription.plan.version}` : 'Compatibilidade sem assinatura persistida'}</p>
              <p className="mt-1 text-xs text-slate-400">{data.subscription ? `Status: ${data.subscription.status}` : 'A compatibilidade preserva o acesso atual até a assinatura estar disponível.'}</p>
              <form onSubmit={saveSubscription} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.25fr_auto] sm:items-end">
                <label className="text-[10px] font-semibold text-slate-400">Plano
                  <select value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100">
                    <option value="">Selecionar plano</option>
                    {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · v{plan.version}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-semibold text-slate-400">Motivo obrigatório
                  <input value={planReason} onChange={(event) => setPlanReason(event.target.value)} placeholder="Ex.: contrato renovado" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                </label>
                <button type="submit" disabled={saving || !planId || !planReason.trim()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">Salvar plano</button>
              </form>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recursos liberados</p><p className="mt-1 text-2xl font-black text-white">{effectiveEnabledCount}<span className="text-sm font-semibold text-slate-500">/{features.length}</span></p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Exceções ativas</p><p className="mt-1 text-2xl font-black text-sky-300">{features.filter((feature) => feature.override).length}</p></div>
              <p className="col-span-2 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-400">O plano é a regra-base. Um controle salvo aqui cria uma exceção auditável e prevalece enquanto estiver ativa.</p>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-white">Recursos e capacidade</h3><p className="mt-0.5 text-[11px] text-slate-400">Escolha um item para ajustar sua regra. Sem lista de formulários repetidos.</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">{features.length} controles</span></div>

              {operatorFeature && <button type="button" onClick={() => setSelectedFeatureId(operatorFeature.featureId)} className={`mb-3 grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3 text-left transition ${selectedFeatureId === operatorFeature.featureId ? 'border-sky-400/70 bg-sky-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-600'}`}>
                <span className={`rounded-lg p-2 ${operatorFeature.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}><UsersRound className="h-4 w-4" /></span>
                <span><span className="block text-sm font-bold text-white">Operadores do tenant</span><span className="mt-0.5 block text-[11px] text-slate-400">{operatorFeature.enabled ? formatQuota(operatorFeature) : 'Novos operadores bloqueados'}</span></span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${operatorFeature.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{operatorFeature.enabled ? 'Liberado' : 'Bloqueado'}</span>
              </button>}

              <div className="space-y-3">
                {groupedFeatures.map(([domain, domainFeatures]) => <div key={domain}>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{getDomainLabel(domain)}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {domainFeatures.map((feature) => <button key={feature.featureId} type="button" onClick={() => setSelectedFeatureId(feature.featureId)} className={`flex min-h-16 items-center gap-2 rounded-xl border p-3 text-left transition ${selectedFeatureId === feature.featureId ? 'border-sky-400/70 bg-sky-500/10' : 'border-slate-800 bg-slate-900/70 hover:border-slate-600'}`}>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${feature.enabled ? 'bg-emerald-400' : 'bg-rose-400'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{feature.name}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{feature.limitValue === null ? sourceLabel[feature.source] : formatQuota(feature)}</span></span>
                      {feature.override && <span title="Exceção ativa" className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />}
                    </button>)}
                  </div>
                </div>)}
              </div>
            </div>

            <aside className="h-fit rounded-2xl border border-slate-700 bg-slate-900 p-4 xl:sticky xl:top-0">
              {selected ? <form onSubmit={saveResourceControl} className="space-y-4">
                <div className="flex items-start gap-2"><SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" /><div><p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">Controle selecionado</p><h3 className="mt-1 text-base font-black text-white">{selected.name}</h3><p className="mt-1 text-[11px] text-slate-400">{getDomainLabel(selected.domain)} · {sourceLabel[selected.source]}</p></div></div>

                {isOperatorsFeature(selected) && <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-100/90">Este controle define se o tenant pode usar operadores e qual é sua capacidade. Ele não bloqueia individualmente um usuário já cadastrado.</div>}

                <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-white">Acesso ao recurso</p><p className="mt-0.5 text-[10px] text-slate-500">A exceção prevalece sobre o plano enquanto ativa.</p></div>
                    <button type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled((current) => !current)} disabled={saving} className={`relative h-7 w-12 rounded-full transition ${enabled ? 'bg-emerald-500' : 'bg-slate-700'} disabled:opacity-50`}>
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? 'left-6' : 'left-1'}`} />
                      <span className="sr-only">{enabled ? 'Liberar recurso' : 'Bloquear recurso'}</span>
                    </button>
                  </div>
                  <p className={`mt-2 text-xs font-bold ${enabled ? 'text-emerald-300' : 'text-rose-300'}`}>{enabled ? 'Liberado' : 'Bloqueado'}</p>
                </div>

                {selected.kind === 'quota' && <label className="block text-[10px] font-semibold text-slate-400">Limite de uso ou operadores
                  <input min="0" step="1" type="number" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} placeholder="Herdar limite do plano" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  <span className="mt-1 block font-normal text-slate-500">Em uso agora: {selected.usage}. Deixe em branco para herdar o limite do plano.</span>
                </label>}

                <label className="block text-[10px] font-semibold text-slate-400">Expira em <span className="font-normal text-slate-500">(opcional)</span>
                  <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100" />
                </label>
                <label className="block text-[10px] font-semibold text-slate-400">Motivo obrigatório
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder={enabled ? 'Ex.: liberação comercial aprovada' : 'Ex.: acesso suspenso até regularização'} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                </label>

                <button type="submit" disabled={saving || !reason.trim()} className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-700 hover:bg-rose-600'}`}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleOff className="h-3.5 w-3.5" />}
                  {enabled ? 'Liberar e registrar' : 'Bloquear e registrar'}
                </button>

                {selected.override && <div className="border-t border-slate-800 pt-3"><p className="mb-2 flex items-center gap-1 text-[10px] text-sky-200"><Clock3 className="h-3.5 w-3.5" /> Exceção ativa {selected.override.expiresAt ? `até ${new Date(selected.override.expiresAt).toLocaleDateString('pt-BR')}` : 'sem expiração'}</p><button type="button" onClick={usePlanRule} disabled={saving || !reason.trim()} className="w-full rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">Restaurar regra do plano</button><p className="mt-1 text-[10px] text-slate-500">Use o mesmo motivo acima para registrar a remoção da exceção.</p></div>}
              </form> : <div className="flex min-h-56 flex-col items-center justify-center text-center text-xs text-slate-500"><Zap className="mb-2 h-5 w-5 text-slate-600" /> Selecione um recurso para controlar seu acesso.</div>}
            </aside>
          </section>

          <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] leading-relaxed text-slate-500"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> O controle visual não substitui as barreiras do sistema: RBAC, RLS e guardas de domínio continuam aplicados. Cada ação usa as rotas exclusivas de administração SaaS e gera auditoria.</p>
        </div>}
      </div>
    </div>
  </div>;
}
