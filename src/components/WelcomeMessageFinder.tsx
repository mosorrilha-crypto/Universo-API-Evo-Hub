import React, { useState } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface WelcomeMessageMatch {
  adId: string;
  adName: string;
  campaignName: string | null;
  effectiveStatus: string | null;
  matchedPath: string;
  matchedSnippet: string;
}

const copy = {
  pt: {
    placeholder: 'Cole a mensagem inicial que o cliente recebeu…',
    button: 'Buscar anúncio',
    searching: 'Buscando…',
    helper: 'Procura entre os anúncios ativos e pausados da conta conectada qual tem essa mensagem inicial de "Clique para WhatsApp" configurada.',
    noMatch: 'Nenhum anúncio da conta conectada tem essa mensagem configurada.',
    matchFound: (count: number) => `${count} anúncio(s) encontrado(s):`,
    matchedIn: 'Encontrado em:',
    rawSnippet: 'Trecho bruto (pra conferir manualmente):',
  },
  es: {
    placeholder: 'Pegá el mensaje inicial que recibió el cliente…',
    button: 'Buscar anuncio',
    searching: 'Buscando…',
    helper: 'Busca entre los anuncios activos y pausados de la cuenta conectada cuál tiene ese mensaje inicial de "Clic para WhatsApp" configurado.',
    noMatch: 'Ningún anuncio de la cuenta conectada tiene ese mensaje configurado.',
    matchFound: (count: number) => `${count} anuncio(s) encontrado(s):`,
    matchedIn: 'Encontrado en:',
    rawSnippet: 'Fragmento bruto (para verificar manualmente):',
  },
};

/**
 * TASK-0365 (pedido direto): quando um lead chega sem atribuição automática
 * de anúncio já gravada (ver TASK-0364 — leads anteriores à correção, ou
 * casos em que a Evolution API não repassou o dado), o operador pode colar
 * a mensagem inicial exata que o cliente recebeu e buscar entre os anúncios
 * da conta conectada qual tem essa mensagem configurada.
 */
export const WelcomeMessageFinder: React.FC<{ language: 'pt' | 'es' }> = ({ language }) => {
  const t = copy[language];
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<WelcomeMessageMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setMatches(null);
    try {
      const response = await apiFetch(`/api/meta-ads/find-by-welcome-message?q=${encodeURIComponent(query.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.noMatch);
      setMatches(data.matches || []);
    } catch (requestError: any) {
      setError(requestError.message || t.noMatch);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{t.helper}</p>
      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.placeholder}
          rows={2}
          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={isSearching || !query.trim()}
          className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Search className="h-4 w-4" />
          {isSearching ? t.searching : t.button}
        </button>
      </form>
      {error && (
        <div className="flex gap-2 rounded-xl border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
          <p>{error}</p>
        </div>
      )}
      {matches && matches.length === 0 && !error && <p className="text-sm text-slate-400">{t.noMatch}</p>}
      {matches && matches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-300">{t.matchFound(matches.length)}</p>
          {matches.map((match) => (
            <div key={match.adId} className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
              <p className="font-semibold text-slate-100">{match.adName}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{match.campaignName} · {match.effectiveStatus}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">{t.matchedIn} <span className="font-mono normal-case">{match.matchedPath}</span></p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{t.rawSnippet}</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-300">{match.matchedSnippet}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
