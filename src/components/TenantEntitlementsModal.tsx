import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Clock3, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type CatalogFeature = { id: string; key: string; name: string; domain: string; kind: 'boolean' | 'quota' | 'configurable'; status: string };
type CatalogPlan = { id: string; key: string; name: string; version: number; status: string; description?: string | null };
type EffectiveEntitlement = {
  featureId: string;
  key: string;
  name: string;
  domain: string;
  kind: string;
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

export function TenantEntitlementsModal({ tenant, onClose }: TenantEntitlementsModalProps) {
  const [catalogFeatures, setCatalogFeatures] = useState<CatalogFeature[]>([]);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [data, setData] = useState<TenantEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planId, setPlanId] = useState('');
  const [planReason, setPlanReason] = useState('');
  const [featureId, setFeatureId] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState<'inherit' | 'enabled' | 'disabled'>('inherit');
  const [overrideLimit, setOverrideLimit] = useState('');
  const [overrideExpiresAt, setOverrideExpiresAt] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});

  const selectedFeature = useMemo(() => catalogFeatures.find((feature) => feature.id === featureId) || null, [catalogFeatures, featureId]);

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
      setCatalogFeatures(catalog.features || []);
      setPlans((catalog.plans || []).filter((plan: CatalogPlan) => plan.status === 'active'));
      setData(entitlements);
      setPlanId(entitlements.subscription?.plan?.id || '');
      setFeatureId((catalog.features || [])[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError.message || 'Falha ao carregar capacidades.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenant.id]);

  const saveSubscription = async (event: FormEvent) => {
    event.preventDefault();
    if (!planId || !planReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/subscription`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId, reason: planReason.trim() }),
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

  const saveOverride = async (event: FormEvent) => {
    event.preventDefault();
    if (!featureId || !overrideReason.trim()) return;
    const payload: Record<string, unknown> = { featureId, reason: overrideReason.trim() };
    if (overrideEnabled !== 'inherit') payload.enabled = overrideEnabled === 'enabled';
    if (overrideLimit.trim()) payload.limitValue = Number(overrideLimit);
    if (overrideExpiresAt) payload.expiresAt = new Date(`${overrideExpiresAt}T23:59:59`).toISOString();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setOverrideEnabled('inherit');
      setOverrideLimit('');
      setOverrideExpiresAt('');
      setOverrideReason('');
      await load();
    } catch (saveError: any) {
      setError(saveError.message || 'Falha ao criar a exceção.');
    } finally {
      setSaving(false);
    }
  };

  const revokeOverride = async (entitlement: EffectiveEntitlement) => {
    const reason = revokeReason[entitlement.featureId]?.trim();
    if (!entitlement.override || !reason) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${tenant.id}/feature-overrides/${entitlement.override.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setRevokeReason((current) => ({ ...current, [entitlement.featureId]: '' }));
      await load();
    } catch (revokeError: any) {
      setError(revokeError.message || 'Falha ao revogar a exceção.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6" onClick={() => !saving && onClose()}>
    <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Contrato e capacidades</p>
          <h2 className="mt-1 text-lg font-black text-white">{tenant.name}</h2>
          <p className="mt-1 text-xs text-slate-400">O estado efetivo combina plano, exceções ativas e consumo. Segmento não concede acesso.</p>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar capacidades" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"><X className="h-4 w-4" /></button>
      </header>

      <div className="space-y-5 p-5 sm:p-6">
        {error && <div className="rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {loading || !data ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando direitos efetivos...</div> : <>
          <section className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/35 p-4 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Contrato atual</p>
              <p className="mt-1 text-sm font-bold text-white">{data.subscription?.plan ? `${data.subscription.plan.name} · v${data.subscription.plan.version}` : 'Compatibilidade sem assinatura persistida'}</p>
              <p className="mt-1 text-xs text-slate-400">{data.subscription ? `Status: ${data.subscription.status}` : 'A aplicação mantém as capacidades atuais enquanto a assinatura não estiver disponível.'}</p>
            </div>
            <form onSubmit={saveSubscription} className="grid gap-2 sm:grid-cols-[1fr_1.25fr_auto] sm:items-end">
              <label className="text-[10px] font-semibold text-slate-400">Plano<select value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100"><option value="">Selecionar plano</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · v{plan.version}</option>)}</select></label>
              <label className="text-[10px] font-semibold text-slate-400">Motivo obrigatório<input value={planReason} onChange={(event) => setPlanReason(event.target.value)} placeholder="Ex.: contrato renovado" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" /></label>
              <button type="submit" disabled={saving || !planId || !planReason.trim()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">Atualizar</button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-emerald-300" /><div><h3 className="text-sm font-bold text-white">Exceção comercial temporária</h3><p className="text-[11px] text-slate-400">Crie apenas quando o plano não representar o contrato deste tenant. Todas as ações exigem motivo e ficam auditáveis.</p></div></div>
            <form onSubmit={saveOverride} className="grid gap-2 md:grid-cols-4">
              <label className="text-[10px] font-semibold text-slate-400">Capacidade<select value={featureId} onChange={(event) => setFeatureId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100">{catalogFeatures.map((feature) => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</select></label>
              <label className="text-[10px] font-semibold text-slate-400">Estado<select value={overrideEnabled} onChange={(event) => setOverrideEnabled(event.target.value as typeof overrideEnabled)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"><option value="inherit">Herdar do plano</option><option value="enabled">Habilitar</option><option value="disabled">Desabilitar</option></select></label>
              <label className="text-[10px] font-semibold text-slate-400">Limite {selectedFeature?.kind === 'quota' ? '(uso por período)' : '(opcional)'}<input min="0" step="1" type="number" value={overrideLimit} onChange={(event) => setOverrideLimit(event.target.value)} placeholder="Sem limite" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" /></label>
              <label className="text-[10px] font-semibold text-slate-400">Expira em<input type="date" value={overrideExpiresAt} onChange={(event) => setOverrideExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100" /></label>
              <label className="md:col-span-3 text-[10px] font-semibold text-slate-400">Motivo obrigatório<input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Ex.: piloto comercial até a renovação" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600" /></label>
              <button type="submit" disabled={saving || !featureId || !overrideReason.trim()} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-50">Criar exceção</button>
            </form>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-white">Direitos efetivos</h3><p className="text-[11px] text-slate-400">A interface mostra a decisão resolvida; ocultar uma tela não é barreira de API.</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">{data.entitlements.length} capacidades</span></div>
            {data.entitlements.map((entitlement) => <article key={entitlement.featureId} className="rounded-xl border border-slate-800 bg-slate-950/35 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h4 className="text-sm font-bold text-white">{entitlement.name}</h4><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entitlement.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{entitlement.enabled ? 'Habilitada' : 'Desabilitada'}</span><span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">{sourceLabel[entitlement.source]}</span></div><p className="mt-1 font-mono text-[10px] text-slate-500">{entitlement.key} · {entitlement.domain}</p></div><div className="text-right text-[11px] text-slate-400">{entitlement.limitValue === null ? 'Sem quota' : <><span className="block font-bold text-slate-200">{entitlement.usage} / {entitlement.limitValue}</span><span>{entitlement.remaining} restante(s)</span></>}</div></div>
              {entitlement.override && <div className="mt-3 grid gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 sm:grid-cols-[1fr_auto]"><div><p className="flex items-center gap-1 text-[11px] font-bold text-sky-200"><Clock3 className="h-3.5 w-3.5" /> Exceção: {entitlement.override.reason}</p><p className="mt-1 text-[10px] text-sky-200/70">{entitlement.override.expiresAt ? `Expira em ${new Date(entitlement.override.expiresAt).toLocaleDateString('pt-BR')}` : 'Sem expiração definida'}</p></div><div className="flex gap-2"><input value={revokeReason[entitlement.featureId] || ''} onChange={(event) => setRevokeReason((current) => ({ ...current, [entitlement.featureId]: event.target.value }))} placeholder="Motivo da revogação" className="min-w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-100 placeholder:text-slate-600" /><button type="button" onClick={() => revokeOverride(entitlement)} disabled={saving || !(revokeReason[entitlement.featureId] || '').trim()} className="rounded-lg border border-rose-700/60 px-2 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-950/50 disabled:opacity-50">Revogar</button></div></div>}
            </article>)}
          </section>
          <p className="flex items-center gap-1.5 text-[10px] text-slate-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Bloqueio do tenant, RBAC, RLS e guardas de domínio continuam independentes destas capacidades.</p>
        </>}
      </div>
    </div>
  </div>;
}
