import { useMemo, useState, type FC } from 'react';
import {
  BarChart3,
  Check,
  Columns3,
  Copy,
  ExternalLink,
  Eye,
  Filter,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';

type DeliveryStatus = 'active' | 'paused' | 'pending_review' | 'disapproved' | 'inactive' | 'unknown';

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
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paused: 'border-slate-200 bg-slate-100 text-slate-600',
  pending_review: 'border-amber-200 bg-amber-50 text-amber-700',
  disapproved: 'border-rose-200 bg-rose-50 text-rose-700',
  inactive: 'border-slate-200 bg-slate-50 text-slate-500',
  unknown: 'border-slate-200 bg-slate-50 text-slate-500',
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
        description: 'Ordená, filtrá y compará anuncios con las métricas que impactan conversaciones.',
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
      }
    : {
        title: 'Comparativo de criativos',
        description: 'Ordene, filtre e compare anúncios pelas métricas que geram conversas.',
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
      };

  const statusLabel: Record<DeliveryStatus, string> = isSpanish
    ? { active: 'Activo', paused: 'Pausado', pending_review: 'En revisión', disapproved: 'Rechazado', inactive: 'Inactivo', unknown: 'Sin estado' }
    : { active: 'Ativo', paused: 'Pausado', pending_review: 'Em análise', disapproved: 'Reprovado', inactive: 'Inativo', unknown: 'Sem status' };

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | DeliveryStatus>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(true);

  const filteredAds = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return ads.filter((ad) => {
      const matchesStatus = status === 'all' || ad.deliveryStatus === status;
      const matchesQuery = !normalizedQuery || [ad.name, ad.adSetName, ad.campaignName].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [ads, query, status]);

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

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-blue-50 p-2 text-blue-600"><BarChart3 className="h-4 w-4" /></span>
              <h3 className="text-base font-bold text-slate-900">{copy.title}</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">{copy.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowQuality((value) => !value)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${showQuality ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Columns3 className="h-3.5 w-3.5" />{copy.columns}: {copy.quality}
            </button>
            {selectedCount > 0 && <>
              <button type="button" onClick={() => void copyText(selectedIds.join(', '), copy.copiedMany)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Copy className="h-3.5 w-3.5" />{selectedCount} {copy.selected}</button>
              <a href={metaHref(selectedIds)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"><ExternalLink className="h-3.5 w-3.5" />{copy.meta}</a>
            </>}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | DeliveryStatus)} className="min-w-[125px] bg-transparent font-semibold outline-none">
            <option value="all">{copy.allStatus}</option>
            {(Object.keys(statusLabel) as DeliveryStatus[]).map((item) => <option value={item} key={item}>{statusLabel[item]}</option>)}
          </select>
        </label>
        <div className="text-xs font-medium text-slate-500"><span className="font-bold text-slate-800">{filteredAds.length}</span> {copy.results}</div>
        {(query || status !== 'all' || selectedCount > 0) && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800"><X className="h-3.5 w-3.5" />{copy.clear}</button>}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full border-collapse text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Selecionar todos" checked={filteredAds.length > 0 && filteredAds.every((ad) => selectedIds.includes(ad.id))} onChange={() => setSelectedIds((current) => filteredAds.every((ad) => current.includes(ad.id)) ? current.filter((id) => !filteredAds.some((ad) => ad.id === id)) : Array.from(new Set([...current, ...filteredAds.map((ad) => ad.id)])))} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th>
              <th className="min-w-[270px] px-3 py-3">{copy.creative}</th>
              <th className="min-w-[190px] px-3 py-3">{copy.campaign}</th>
              <th className="min-w-[116px] px-3 py-3">{copy.delivery}</th>
              <th className="px-3 py-3 text-right">{copy.spend}</th>
              <th className="px-3 py-3 text-right">{copy.conversations}</th>
              <th className="px-3 py-3 text-right">{copy.cost}</th>
              <th className="px-3 py-3 text-right">{copy.ctr}</th>
              {showQuality && <th className="min-w-[175px] px-3 py-3">{copy.quality}</th>}
              <th className="sticky right-0 border-l border-slate-200 bg-slate-100 px-4 py-3 text-right">{copy.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredAds.map((ad) => {
              const isSelected = selectedIds.includes(ad.id);
              return <tr key={ad.id} className={`group transition-colors ${isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}>
                <td className="px-4 py-3"><input type="checkbox" aria-label={`Selecionar ${ad.name}`} checked={isSelected} onChange={() => toggleSelection(ad.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                <td className="px-3 py-3"><button type="button" onClick={() => setSelectedAdId(ad.id)} className="block max-w-[270px] text-left font-bold text-slate-800 hover:text-blue-700 hover:underline"><span className="line-clamp-1">{ad.name}</span></button><p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{copy.adSet}: {ad.adSetName}</p></td>
                <td className="px-3 py-3 text-slate-700"><span className="line-clamp-2">{ad.campaignName}</span></td>
                <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-bold ${statusStyle[ad.deliveryStatus]}`}>{statusLabel[ad.deliveryStatus]}</span></td>
                <td className="px-3 py-3 text-right font-medium text-slate-800">{money(ad.spend, currency, locale)}</td>
                <td className="px-3 py-3 text-right font-medium text-slate-800">{number(ad.messagingConversations, locale)}</td>
                <td className="px-3 py-3 text-right font-bold text-emerald-700">{money(ad.costPerMessagingConversation, currency, locale)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{percentage(ad.ctr, locale)}</td>
                {showQuality && <td className="px-3 py-3"><p className="text-slate-700">{rank(ad.qualityRanking)}</p><p className="mt-1 text-[10px] text-slate-500">{copy.engagement}: {rank(ad.engagementRateRanking)}</p></td>}
                <td className="sticky right-0 border-l border-slate-100 bg-inherit px-4 py-3"><div className="flex justify-end gap-1 opacity-100 transition-opacity xl:opacity-0 xl:group-hover:opacity-100"><button type="button" onClick={() => setSelectedAdId(ad.id)} title={copy.details} aria-label={copy.details} className="rounded-md p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><Eye className="h-4 w-4" /></button><button type="button" onClick={() => void copyText(ad.id, copy.copied)} title={copy.copyId} aria-label={copy.copyId} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Copy className="h-4 w-4" /></button><a href={metaHref([ad.id])} target="_blank" rel="noreferrer" title={copy.meta} aria-label={copy.meta} className="rounded-md p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><ExternalLink className="h-4 w-4" /></a></div></td>
              </tr>;
            })}
            {filteredAds.length === 0 && <tr><td colSpan={showQuality ? 10 : 9} className="px-5 py-12 text-center text-sm text-slate-500"><MessageCircle className="mx-auto mb-2 h-6 w-6 text-slate-300" />{copy.empty}</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedAd && <div className="border-t border-slate-200 bg-blue-50/60 px-4 py-4 sm:px-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-600">{copy.selectedTitle}</p><h4 className="mt-1 text-sm font-bold text-slate-900">{selectedAd.name}</h4><p className="mt-1 text-xs text-slate-600">{selectedAd.campaignName} · {copy.adSet}: {selectedAd.adSetName}</p><p className="mt-2 font-mono text-[10px] text-slate-500">ID: {selectedAd.id}</p></div><div className="flex gap-2"><button type="button" onClick={() => void copyText(selectedAd.id, copy.copied)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"><Copy className="h-3.5 w-3.5" />{copy.copyId}</button><a href={metaHref([selectedAd.id])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"><ExternalLink className="h-3.5 w-3.5" />{copy.meta}</a><button type="button" onClick={() => setSelectedAdId(null)} aria-label={copy.clear} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button></div></div></div>}
    </section>
  );
};
