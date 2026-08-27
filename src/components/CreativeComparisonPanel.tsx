import { useEffect, useMemo, useState, type FC } from 'react';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  ExternalLink,
  Eye,
  Filter,
  ListFilter,
  MessageCircle,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';

type DeliveryStatus = 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';
type InternalSection = 'results' | 'filters' | 'columns';

type CreativeAd = {
  id: string;
  name: string;
  campaignName: string;
  adSetName: string;
  deliveryStatus: DeliveryStatus;
  spend: number;
  ctr: number | null;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
};

type CreativeComparisonPanelProps = {
  ads: CreativeAd[];
  accountId: string;
  currency: string;
  locale: string;
  language: 'pt' | 'es';
  money: (value: number | null | undefined, currency: string, locale: string) => string;
  number: (value: number | null | undefined, locale: string) => string;
  percentage: (value: number | null | undefined, locale: string) => string;
  rank: (value: string | null) => string;
  onNotice: (message: string) => void;
};

const statusStyle: Record<DeliveryStatus, string> = {
  active: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  paused: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  pending_review: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  disapproved: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  inactive: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  unknown: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
};

export const CreativeComparisonPanel: FC<CreativeComparisonPanelProps> = ({
  ads,
  accountId,
  currency,
  locale,
  language,
  money,
  number,
  percentage,
  rank,
  onNotice,
}) => {
  const isSpanish = language === 'es';
  const copy = isSpanish
    ? {
        title: 'Comparativo de creativos',
        description: 'Compare anuncios por las métricas que generan conversaciones.',
        search: 'Buscar creativo, conjunto o campaña',
        allStatus: 'Todos los estados',
        results: 'resultados',
        selected: 'seleccionados',
        clear: 'Limpiar',
        columns: 'Columnas',
        quality: 'Calidad',
        creative: 'Creativo / anuncio',
        campaign: 'Campaña',
        delivery: 'Entrega',
        spend: 'Inversión',
        conversations: 'Conversaciones',
        cost: 'Costo por conversación',
        ctr: 'CTR',
        actions: 'Acciones',
        details: 'Ver detalle',
        meta: 'Abrir en Meta',
        copyId: 'Copiar ID',
        copied: 'ID del anuncio copiado.',
        copiedMany: 'IDs de anuncios copiados.',
        selectedTitle: 'Detalle del creativo',
        adSet: 'Conjunto',
        engagement: 'Interacción',
        empty: 'No encontramos creativos con estos filtros.',
        resultTab: 'Resultados',
        filterTab: 'Filtros',
        columnTab: 'Columnas',
        filterHint: 'Ajustá la lista sin perder el contexto.',
        columnHint: 'Elegí qué información mostrar en la tabla.',
        showing: 'Mostrando',
        previous: 'Anterior',
        next: 'Siguiente',
        page: 'Página',
      }
    : {
        title: 'Comparar criativos',
        description: 'Compare anúncios pelas métricas que geram conversas.',
        search: 'Buscar criativo, conjunto ou campanha',
        allStatus: 'Todos os status',
        results: 'resultados',
        selected: 'selecionados',
        clear: 'Limpar',
        columns: 'Colunas',
        quality: 'Qualidade',
        creative: 'Criativo / anúncio',
        campaign: 'Campanha',
        delivery: 'Veiculação',
        spend: 'Investimento',
        conversations: 'Conversas',
        cost: 'Custo por conversa',
        ctr: 'CTR',
        actions: 'Ações',
        details: 'Ver detalhes',
        meta: 'Abrir na Meta',
        copyId: 'Copiar ID',
        copied: 'ID do anúncio copiado.',
        copiedMany: 'IDs dos anúncios copiados.',
        selectedTitle: 'Detalhe do criativo',
        adSet: 'Conjunto',
        engagement: 'Engajamento',
        empty: 'Nenhum criativo foi encontrado com estes filtros.',
        resultTab: 'Resultados',
        filterTab: 'Filtros',
        columnTab: 'Colunas',
        filterHint: 'Ajuste a lista sem perder o contexto.',
        columnHint: 'Escolha quais informações aparecem na tabela.',
        showing: 'Exibindo',
        previous: 'Anterior',
        next: 'Próxima',
        page: 'Página',
      };

  const statusLabel: Record<DeliveryStatus, string> = isSpanish
    ? { active: 'Activo', paused: 'Pausado', pending_review: 'En revisión', disapproved: 'Rechazado', inactive: 'Inactivo', unknown: 'Sin estado' }
    : { active: 'Ativo', paused: 'Pausado', pending_review: 'Em análise', disapproved: 'Reprovado', inactive: 'Inativo', unknown: 'Sem status' };

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | DeliveryStatus>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(true);
  const [activeSection, setActiveSection] = useState<InternalSection>('results');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const filteredAds = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return ads.filter((ad) => {
      const matchesStatus = status === 'all' || ad.deliveryStatus === status;
      const matchesQuery = !normalizedQuery || [ad.name, ad.adSetName, ad.campaignName].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [ads, query, status]);

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  const pageCount = Math.max(1, Math.ceil(filteredAds.length / pageSize));
  const visibleAds = filteredAds.slice((page - 1) * pageSize, page * pageSize);
  const selectedAd = ads.find((ad) => ad.id === selectedAdId) || null;
  const selectedCount = selectedIds.length;
  const account = accountId.replace(/^act_/, '');
  const metaHref = (ids: string[]) => `https://www.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(account)}&selected_ad_ids=${encodeURIComponent(ids.join(','))}`;

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const copyText = async (text: string, notice: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotice(notice);
    } catch {
      onNotice(isSpanish ? 'No fue posible copiar automáticamente.' : 'Não foi possível copiar automaticamente.');
    }
  };

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setSelectedIds([]);
    setSelectedAdId(null);
  };

  const selectAllVisible = () => {
    setSelectedIds((current) => visibleAds.every((ad) => current.includes(ad.id))
      ? current.filter((id) => !visibleAds.some((ad) => ad.id === id))
      : Array.from(new Set([...current, ...visibleAds.map((ad) => ad.id)])));
  };

  const renderActions = (ad: CreativeAd) => (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => setSelectedAdId(ad.id)} title={copy.details} aria-label={copy.details} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/10 hover:text-emerald-300"><Eye className="h-4 w-4" /></button>
      <button type="button" onClick={() => void copyText(ad.id, copy.copied)} title={copy.copyId} aria-label={copy.copyId} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/70 hover:text-slate-100"><Copy className="h-4 w-4" /></button>
      <a href={metaHref([ad.id])} target="_blank" rel="noreferrer" title={copy.meta} aria-label={copy.meta} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/10 hover:text-emerald-300"><ExternalLink className="h-4 w-4" /></a>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-slate-950 text-slate-100 shadow-[0_22px_60px_-32px_rgba(0,0,0,0.95)]">
      <header className="border-b border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950/30 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-300"><BarChart3 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold tracking-tight text-white">{copy.title}</h3>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{copy.description}</p>
              </div>
            </div>
          </div>
          {selectedCount > 0 && <div className="hidden items-center gap-2 sm:flex">
            <button type="button" onClick={() => void copyText(selectedIds.join(', '), copy.copiedMany)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"><Copy className="h-3.5 w-3.5" />{selectedCount}</button>
            <a href={metaHref(selectedIds)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"><ExternalLink className="h-3.5 w-3.5" />{copy.meta}</a>
          </div>}
        </div>
      </header>

      <nav aria-label={isSpanish ? 'Secciones del comparativo' : 'Seções do comparativo'} className="custom-scrollbar flex overflow-x-auto border-b border-white/10 bg-slate-900/80 p-2">
        {([
          { id: 'results' as const, label: copy.resultTab, icon: ListFilter, count: filteredAds.length },
          { id: 'filters' as const, label: copy.filterTab, icon: SlidersHorizontal, count: query || status !== 'all' ? 1 : 0 },
          { id: 'columns' as const, label: copy.columnTab, icon: Settings2, count: showQuality ? 0 : 1 },
        ]).map(({ id, label, icon: Icon, count }) => (
          <button key={id} type="button" onClick={() => setActiveSection(id)} aria-current={activeSection === id ? 'page' : undefined} className={`flex min-w-max items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${activeSection === id ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
            <Icon className="h-3.5 w-3.5" />{label}{count > 0 && <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-300">{count}</span>}
          </button>
        ))}
      </nav>

      {activeSection === 'filters' && <div className="border-b border-white/10 bg-slate-900/50 px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-2"><Filter className="h-4 w-4 text-emerald-300" /><div><p className="text-sm font-bold text-white">{copy.filterTab}</p><p className="text-xs text-slate-400">{copy.filterHint}</p></div></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="relative min-w-0">
            <span className="sr-only">{copy.search}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 pl-9 text-xs text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-xs text-slate-300">
            <span className="sr-only">{copy.allStatus}</span><Filter className="h-3.5 w-3.5 text-slate-500" />
            <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | DeliveryStatus)} className="min-w-0 flex-1 bg-transparent font-semibold outline-none">
              <option value="all">{copy.allStatus}</option>
              {(Object.keys(statusLabel) as DeliveryStatus[]).map((item) => <option value={item} key={item}>{statusLabel[item]}</option>)}
            </select>
          </label>
          {(query || status !== 'all') && <button type="button" onClick={clearFilters} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"><X className="h-3.5 w-3.5" />{copy.clear}</button>}
        </div>
      </div>}

      {activeSection === 'columns' && <div className="border-b border-white/10 bg-slate-900/50 px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-2"><Columns3 className="h-4 w-4 text-emerald-300" /><div><p className="text-sm font-bold text-white">{copy.columnTab}</p><p className="text-xs text-slate-400">{copy.columnHint}</p></div></div>
        <button type="button" onClick={() => setShowQuality((value) => !value)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${showQuality ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>
          {showQuality ? <Check className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}{copy.quality}
        </button>
      </div>}

      {activeSection === 'results' && <>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900/40 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={selectAllVisible} aria-label={isSpanish ? 'Seleccionar resultados visibles' : 'Selecionar resultados visíveis'} className="flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-slate-950 text-emerald-300"><span className="sr-only">{isSpanish ? 'Seleccionar resultados visibles' : 'Selecionar resultados visíveis'}</span>{visibleAds.length > 0 && visibleAds.every((ad) => selectedIds.includes(ad.id)) && <Check className="h-3.5 w-3.5" />}</button><span className="truncate text-xs text-slate-400"><strong className="text-white">{filteredAds.length}</strong> {copy.results}</span></div>
          <div className="flex items-center gap-1 text-xs text-slate-500"><span className="hidden sm:inline">{copy.showing}</span> {filteredAds.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredAds.length)}</div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-b border-white/10 bg-white/[0.03] text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3" aria-hidden="true" />
                <th className="min-w-[245px] px-3 py-3">{copy.creative}</th>
                <th className="min-w-[170px] px-3 py-3">{copy.campaign}</th>
                <th className="min-w-[110px] px-3 py-3">{copy.delivery}</th>
                <th className="px-3 py-3 text-right">{copy.spend}</th>
                <th className="px-3 py-3 text-right">{copy.conversations}</th>
                <th className="px-3 py-3 text-right">{copy.cost}</th>
                <th className="px-3 py-3 text-right">{copy.ctr}</th>
                {showQuality && <th className="min-w-[150px] px-3 py-3">{copy.quality}</th>}
                <th className="sticky right-0 border-l border-white/10 bg-slate-900 px-4 py-3 text-right">{copy.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {visibleAds.map((ad) => {
                const isSelected = selectedIds.includes(ad.id);
                return <tr key={ad.id} className={`group transition-colors ${isSelected ? 'bg-emerald-400/[0.07]' : 'hover:bg-white/[0.03]'}`}>
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Selecionar ${ad.name}`} checked={isSelected} onChange={() => toggleSelection(ad.id)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500" /></td>
                  <td className="px-3 py-3"><button type="button" onClick={() => setSelectedAdId(ad.id)} className="block max-w-[245px] text-left font-bold text-slate-100 hover:text-emerald-300 hover:underline"><span className="line-clamp-1">{ad.name}</span></button><p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{copy.adSet}: {ad.adSetName}</p></td>
                  <td className="px-3 py-3 text-slate-300"><span className="line-clamp-2">{ad.campaignName}</span></td>
                  <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-bold ${statusStyle[ad.deliveryStatus]}`}>{statusLabel[ad.deliveryStatus]}</span></td>
                  <td className="px-3 py-3 text-right font-medium text-slate-200">{money(ad.spend, currency, locale)}</td>
                  <td className="px-3 py-3 text-right font-medium text-slate-200">{number(ad.messagingConversations, locale)}</td>
                  <td className="px-3 py-3 text-right font-bold text-emerald-300">{money(ad.costPerMessagingConversation, currency, locale)}</td>
                  <td className="px-3 py-3 text-right text-slate-300">{percentage(ad.ctr, locale)}</td>
                  {showQuality && <td className="px-3 py-3"><p className="text-slate-300">{rank(ad.qualityRanking)}</p><p className="mt-1 text-[10px] text-slate-500">{copy.engagement}: {rank(ad.engagementRateRanking)}</p></td>}
                  <td className="sticky right-0 border-l border-white/10 bg-slate-900/95 px-4 py-3">{renderActions(ad)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-white/[0.06] md:hidden">
          {visibleAds.map((ad) => {
            const isSelected = selectedIds.includes(ad.id);
            return <article key={ad.id} className={`p-4 ${isSelected ? 'bg-emerald-400/[0.07]' : ''}`}>
              <div className="flex items-start gap-3"><input type="checkbox" aria-label={`Selecionar ${ad.name}`} checked={isSelected} onChange={() => toggleSelection(ad.id)} className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><button type="button" onClick={() => setSelectedAdId(ad.id)} className="line-clamp-2 text-left text-sm font-bold text-slate-100 hover:text-emerald-300">{ad.name}</button><span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold ${statusStyle[ad.deliveryStatus]}`}>{statusLabel[ad.deliveryStatus]}</span></div><p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{copy.adSet}: {ad.adSetName}</p><p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{ad.campaignName}</p></div></div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs"><div><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.spend}</p><p className="mt-1 font-semibold text-slate-200">{money(ad.spend, currency, locale)}</p></div><div><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.conversations}</p><p className="mt-1 font-semibold text-slate-200">{number(ad.messagingConversations, locale)}</p></div><div><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.cost}</p><p className="mt-1 font-bold text-emerald-300">{money(ad.costPerMessagingConversation, currency, locale)}</p></div><div><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.ctr}</p><p className="mt-1 font-semibold text-slate-200">{percentage(ad.ctr, locale)}</p></div></div>
              <div className="mt-2">{renderActions(ad)}</div>
            </article>;
          })}
        </div>

        {visibleAds.length === 0 && <div className="px-5 py-12 text-center text-sm text-slate-500"><MessageCircle className="mx-auto mb-2 h-6 w-6 text-slate-600" />{copy.empty}</div>}

        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-slate-900/40 px-4 py-3 text-xs text-slate-400 sm:px-5"><span>{copy.page} {page} / {pageCount}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label={copy.previous} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 font-semibold hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" />{copy.previous}</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label={copy.next} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 font-semibold hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30">{copy.next}<ChevronRight className="h-3.5 w-3.5" /></button></div></div>
      </>}

      {selectedAd && <div className="border-t border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-4 sm:px-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">{copy.selectedTitle}</p><h4 className="mt-1 truncate text-sm font-bold text-white">{selectedAd.name}</h4><p className="mt-1 text-xs text-slate-400">{selectedAd.campaignName} · {copy.adSet}: {selectedAd.adSetName}</p><p className="mt-2 font-mono text-[10px] text-slate-500">ID: {selectedAd.id}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copyText(selectedAd.id, copy.copied)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"><Copy className="h-3.5 w-3.5" />{copy.copyId}</button><a href={metaHref([selectedAd.id])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"><ExternalLink className="h-3.5 w-3.5" />{copy.meta}</a><button type="button" onClick={() => setSelectedAdId(null)} aria-label={copy.clear} className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button></div></div></div>}
    </section>
  );
};
