import React, { useState } from 'react';
import { CheckCircle2, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

type Campaign = { id: string; name: string };
type Language = 'pt' | 'es';

interface Props { language: Language; managementConfigured: boolean; campaigns: Campaign[]; onRefresh: () => Promise<void>; }

const key = () => `meta-${Date.now().toString(36)}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export const MetaAdsResourceBuilder: React.FC<Props> = ({ language, managementConfigured, campaigns, onRefresh }) => {
  const pt = language === 'pt';
  const [mode, setMode] = useState<'adset' | 'ad'>('adset');
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id || '');
  const [adSetId, setAdSetId] = useState('');
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [targeting, setTargeting] = useState('{"geo_locations":{"countries":["PY"]}}');
  const [creativeId, setCreativeId] = useState('');
  const [objectStoryId, setObjectStoryId] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setNotice(null); setError(null);
    if (!name.trim() || (mode === 'adset' && (!campaignId || !budget.trim())) || (mode === 'ad' && !adSetId.trim())) {
      setError(pt ? 'Preencha os campos obrigatórios.' : 'Completá los campos obligatorios.'); return;
    }
    if (mode === 'ad' && !creativeId.trim() && !objectStoryId.trim()) { setError(pt ? 'Informe o creative ID ou o object story ID.' : 'Ingresá el creative ID o el object story ID.'); return; }
    if (mode === 'adset') { try { JSON.parse(targeting); } catch { setError(pt ? 'A segmentação precisa ser um JSON válido.' : 'La segmentación debe ser un JSON válido.'); return; } }
    setPending(true);
    try {
      const body = mode === 'adset' ? { campaignId, name: name.trim(), dailyBudgetMinor: Number(budget), targeting: JSON.parse(targeting), confirmation: 'CONFIRMAR_NO_UNIVERSO' } : { adSetId: adSetId.trim(), name: name.trim(), creativeId: creativeId.trim() || undefined, objectStoryId: objectStoryId.trim() || undefined, confirmation: 'CONFIRMAR_NO_UNIVERSO' };
      const response = await apiFetch(mode === 'adset' ? '/api/meta-ads/adsets' : '/api/meta-ads/ads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key() }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (pt ? 'A Meta recusou a operação.' : 'Meta rechazó la operación.'));
      setNotice(pt ? `${mode === 'adset' ? 'Conjunto' : 'Anúncio'} criado pausado na Meta.` : `${mode === 'adset' ? 'Conjunto' : 'Anuncio'} creado pausado en Meta.`); setName(''); setBudget(''); setAdSetId(''); setCreativeId(''); setObjectStoryId(''); await onRefresh();
    } catch (requestError: any) { setError(requestError.message || (pt ? 'Não foi possível concluir.' : 'No fue posible completar.')); } finally { setPending(false); }
  };

  return <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="flex items-center gap-2 font-bold text-white"><Plus className="h-4 w-4 text-indigo-300" />{pt ? 'Criar conjunto ou anúncio' : 'Crear conjunto o anuncio'}</h4><p className="mt-1 text-xs text-slate-500">{pt ? 'Tudo nasce PAUSED. A ativação continua separada e exige confirmação.' : 'Todo nace PAUSED. La activación sigue separada y exige confirmación.'}</p></div><div className="flex rounded-lg border border-slate-700 p-0.5"><button type="button" onClick={() => setMode('adset')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${mode === 'adset' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>{pt ? 'Conjunto' : 'Conjunto'}</button><button type="button" onClick={() => setMode('ad')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${mode === 'ad' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>{pt ? 'Anúncio' : 'Anuncio'}</button></div></div>
    {!managementConfigured && <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200">{pt ? 'Configure o token de gestão para habilitar escrita.' : 'Configurá el token de gestión para habilitar escritura.'}</p>}
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      {mode === 'adset' ? <><label className="text-xs text-slate-300">{pt ? 'Campanha' : 'Campaña'}<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} disabled={!managementConfigured || pending} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label className="text-xs text-slate-300">{pt ? 'Orçamento diário (menor unidade)' : 'Presupuesto diario (menor unidad)'}<input value={budget} onChange={(event) => setBudget(event.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-300 md:col-span-2">{pt ? 'Segmentação JSON' : 'Segmentación JSON'}<textarea value={targeting} onChange={(event) => setTargeting(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" /></label></> : <><label className="text-xs text-slate-300">Ad set ID<input value={adSetId} onChange={(event) => setAdSetId(event.target.value)} placeholder="123456789" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-300">{pt ? 'Creative ID (ou object story ID abaixo)' : 'Creative ID (o object story ID abajo)'}<input value={creativeId} onChange={(event) => setCreativeId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-300 md:col-span-2">Object story ID<input value={objectStoryId} onChange={(event) => setObjectStoryId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label></>}
      <label className="text-xs text-slate-300 md:col-span-2">{pt ? 'Nome' : 'Nombre'}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label>
      {error && <p className="text-xs text-rose-300 md:col-span-2">{error}</p>}{notice && <p className="flex items-center gap-2 text-xs text-emerald-300 md:col-span-2"><CheckCircle2 className="h-4 w-4" />{notice}</p>}
      <button type="submit" disabled={!managementConfigured || pending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 md:col-span-2">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{pt ? 'Criar pausado' : 'Crear pausado'}</button>
    </form>
  </section>;
};
