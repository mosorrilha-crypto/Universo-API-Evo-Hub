import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronRight, CircleDollarSign, Loader2, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';

type CommercialPlan = {
  key: 'essencial' | 'profissional';
  name: string;
  description: string | null;
  price: string;
  featured: boolean;
  audience: string;
  capabilities: Array<{ key: string; name: string; limit: number | null }>;
};

const benefitCopy: Record<string, (limit: number | null) => string> = {
  'inbox.conversations': () => 'Central de conversas pelo WhatsApp',
  'booking.calendar': () => 'Agenda integrada à operação',
  'crm.follow_ups': (limit) => limit ? `Até ${limit.toLocaleString('pt-BR')} acompanhamentos por mês` : 'Acompanhamento de CRM',
  'sales.financial': () => 'Financeiro ligado às vendas',
  'catalog.public_page': () => 'Catálogo público para converter interesse',
  'channel.meta_whatsapp': () => 'Canal oficial de WhatsApp',
  'channel.evolution': () => 'Conexão operacional de WhatsApp',
  'admin.tenant_operators': (limit) => limit ? `Até ${limit} operadores` : 'Gestão de operadores',
  'ai.auto_reply': (limit) => limit ? `Até ${limit.toLocaleString('pt-BR')} respostas com IA por mês` : 'Agente de IA para responder leads',
  'booking.reminders': (limit) => limit ? `Até ${limit.toLocaleString('pt-BR')} lembretes por mês` : 'Lembretes de agendamento',
  'growth.meta_ads': () => 'Visão de crescimento e anúncios',
  'channel.instagram': () => 'Canal Instagram integrado',
  'quality.agent_review': () => 'Revisão e melhoria do agente',
};

const benefitOrder = [
  'inbox.conversations', 'ai.auto_reply', 'booking.calendar', 'booking.reminders',
  'crm.follow_ups', 'sales.financial', 'catalog.public_page', 'growth.meta_ads',
  'channel.instagram', 'quality.agent_review', 'admin.tenant_operators',
];

function planBenefits(plan: CommercialPlan) {
  const capabilities = new Map(plan.capabilities.map((capability) => [capability.key, capability]));
  return benefitOrder
    .filter((key) => capabilities.has(key))
    .map((key) => {
      const capability = capabilities.get(key)!;
      return benefitCopy[key]?.(capability.limit) || capability.name;
    });
}

export default function PublicOfferPage() {
  const [plans, setPlans] = useState<CommercialPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'essencial' | 'profissional'>('profissional');
  const [form, setForm] = useState({ name: '', businessName: '', whatsapp: '', email: '', note: '', consent: false });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/oferta')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body.plans as CommercialPlan[];
      })
      .then((result) => { if (!cancelled) setPlans(result); })
      .catch((error) => { if (!cancelled) setLoadError(error.message || 'Não foi possível carregar as ofertas.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => plans.find((plan) => plan.key === selectedPlan), [plans, selectedPlan]);

  const choosePlan = (key: CommercialPlan['key']) => {
    setSelectedPlan(key);
    setSuccess(false);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch('/api/public/oferta/interesse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: selectedPlan, ...form }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível registrar seu interesse.');
      setSuccess(true);
      setForm({ name: '', businessName: '', whatsapp: '', email: '', note: '', consent: false });
    } catch (error: any) {
      setFormError(error.message || 'Não foi possível registrar seu interesse.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="min-h-screen bg-[#07111f] text-slate-100 selection:bg-emerald-400/30">
    <div className="pointer-events-none fixed inset-x-0 top-0 h-[38rem] overflow-hidden"><div className="absolute left-1/2 top-[-17rem] h-[38rem] w-[65rem] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" /><div className="absolute right-[-10rem] top-40 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" /></div>

    <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><a href="/" className="flex items-center gap-2 text-sm font-black tracking-tight text-white"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400 text-slate-950"><Sparkles className="h-4 w-4" /></span> UNIVERSO</a><a href="#planos" className="text-xs font-bold text-slate-300 transition hover:text-white">Conhecer planos <ChevronRight className="inline h-3.5 w-3.5" /></a></nav>

    <section className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 text-center sm:px-8 sm:pb-24 sm:pt-20">
      <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-200"><Sparkles className="h-3.5 w-3.5" /> Atendimento, vendas e agenda no mesmo lugar</p>
      <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-6xl">Sua operação de WhatsApp não precisa viver em planilhas.</h1>
      <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">O Universo transforma cada conversa em uma próxima ação clara: atender, vender, agendar, receber ou crescer.</p>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"><a href="#planos" className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-300">Ver planos <ArrowRight className="h-4 w-4" /></a><p className="text-xs text-slate-400">Comece sem cartão. Conversamos antes de qualquer contratação.</p></div>
    </section>

    <section className="relative mx-auto grid max-w-5xl gap-3 px-5 pb-20 sm:grid-cols-3 sm:px-8"><div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 text-left"><MessageCircle className="h-5 w-5 text-emerald-300" /><h2 className="mt-3 text-sm font-bold text-white">Conversa vira contexto</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Veja o histórico e a próxima ação, sem perder leads no WhatsApp.</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 text-left"><CalendarDays className="h-5 w-5 text-sky-300" /><h2 className="mt-3 text-sm font-bold text-white">Venda vira agenda</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Organize disponibilidade, confirmações e o atendimento de cada dia.</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 text-left"><CircleDollarSign className="h-5 w-5 text-amber-300" /><h2 className="mt-3 text-sm font-bold text-white">Agenda vira resultado</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Acompanhe vendas e recebimentos na mesma operação comercial.</p></div></section>

    <section id="planos" className="relative mx-auto max-w-6xl scroll-mt-5 px-5 pb-24 sm:px-8"><div className="mx-auto mb-10 max-w-2xl text-center"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">Planos claros para operar melhor</p><h2 className="mt-3 text-3xl font-black tracking-tight text-white">Comece organizado. Evolua quando a operação pedir.</h2><p className="mt-3 text-sm leading-relaxed text-slate-400">Cada plano define recursos e limites de forma transparente. Você sempre sabe o que está incluído.</p></div>
      {loading && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando ofertas...</div>}
      {loadError && <div className="mx-auto max-w-xl rounded-2xl border border-rose-900 bg-rose-950/35 p-4 text-center text-sm text-rose-200">{loadError}</div>}
      {!loading && !loadError && <div className="grid gap-5 lg:grid-cols-2">{plans.map((plan) => <article key={plan.key} className={`relative rounded-3xl border p-6 sm:p-8 ${plan.featured ? 'border-emerald-300/60 bg-gradient-to-b from-emerald-400/15 to-slate-900 shadow-[0_0_60px_rgba(52,211,153,0.11)]' : 'border-slate-700 bg-slate-900/70'}`}>
        {plan.featured && <span className="absolute -top-3 left-6 rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-950">Mais escolhido para crescer</span>}
        <div className="flex items-start justify-between gap-4"><div><h3 className="text-2xl font-black text-white">{plan.name}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-300">{plan.description}</p></div><span className="rounded-xl bg-slate-950/70 px-2.5 py-1 text-[10px] font-bold text-slate-300">{plan.featured ? 'Escala' : 'Base'}</span></div>
        <div className="mt-7"><p className="text-3xl font-black text-white">{plan.price}</p><p className="mt-1 text-xs text-slate-400">{plan.audience}</p></div>
        <ul className="mt-7 space-y-3 border-t border-slate-700/60 pt-6">{planBenefits(plan).map((benefit) => <li key={benefit} className="flex gap-2.5 text-sm text-slate-200"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check className="h-3 w-3" /></span>{benefit}</li>)}</ul>
        <button type="button" onClick={() => choosePlan(plan.key)} className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${plan.featured ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>Quero conhecer o {plan.name} <ArrowRight className="h-4 w-4" /></button>
      </article>)}</div>}
    </section>

    <section ref={formRef} className="relative border-y border-slate-800 bg-slate-950/60 py-16"><div className="mx-auto grid max-w-5xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">Próximo passo simples</p><h2 className="mt-3 text-3xl font-black tracking-tight text-white">Conte sobre seu negócio. Nós mostramos o melhor caminho.</h2><p className="mt-4 text-sm leading-relaxed text-slate-400">Você não será cobrado por este contato. Vamos entender sua rotina atual e confirmar se o Universo faz sentido antes de qualquer contratação.</p><div className="mt-6 flex items-start gap-3 text-xs leading-relaxed text-slate-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> Seus dados são usados somente para responder a este interesse comercial.</div></div>
      <form onSubmit={submit} className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-300">Seu nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2" placeholder="Como podemos chamar você?" /></label><label className="text-xs font-bold text-slate-300">Seu negócio<input required value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2" placeholder="Nome da empresa" /></label><label className="text-xs font-bold text-slate-300">WhatsApp<input required value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2" placeholder="+595 ..." /></label><label className="text-xs font-bold text-slate-300">E-mail <span className="font-normal text-slate-500">(opcional)</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2" placeholder="voce@empresa.com" /></label></div><label className="mt-4 block text-xs font-bold text-slate-300">Plano de interesse<select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value as 'essencial' | 'profissional')} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2">{plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.name} — {plan.price}</option>)}</select></label><label className="mt-4 block text-xs font-bold text-slate-300">O que você quer melhorar? <span className="font-normal text-slate-500">(opcional)</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="mt-1.5 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-emerald-400/50 transition focus:ring-2" placeholder="Ex.: quero responder leads mais rápido e reduzir faltas na agenda." /></label><label className="mt-4 flex gap-2 text-xs leading-relaxed text-slate-400"><input required type="checkbox" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-400" /> Concordo em receber contato da equipe Universo sobre esta oferta.</label>{formError && <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/35 p-3 text-xs text-rose-200">{formError}</p>}{success && <p className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/35 p-3 text-xs text-emerald-100">Recebemos seu interesse. A equipe entrará em contato para entender sua operação.</p>}<button type="submit" disabled={submitting} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:opacity-60">{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : <>Quero falar sobre {selected?.name || 'este plano'} <ArrowRight className="h-4 w-4" /></>}</button></form>
    </div></section>
    <footer className="relative mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>Universo — operação comercial por WhatsApp.</span><span>Planos sujeitos à confirmação comercial. Sem cobrança automática nesta etapa.</span></footer>
  </main>;
}
