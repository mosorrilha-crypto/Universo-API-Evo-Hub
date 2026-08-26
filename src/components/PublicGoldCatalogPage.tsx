/*
 * Segunda experiência pública: catálogo Gold gamificado da Monique.
 * A rota original `/catalogo/:slug` permanece no PublicCatalogPage sem este template.
 */
import { useEffect, useState } from 'react';
import { GoldCatalogTemplate } from './GoldCatalogTemplate';
import type { CatalogLanguage, PublicCatalog } from './PublicCatalogPage';

interface PublicGoldCatalogPageProps {
  slug: string;
}

export function PublicGoldCatalogPage({ slug }: PublicGoldCatalogPageProps) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState(false);
  const [language, setLanguage] = useState<CatalogLanguage>(() => (
    typeof window !== 'undefined' && window.localStorage.getItem('monique-gold-catalog-language') === 'pt' ? 'pt' : 'es'
  ));

  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : 'es-PY';
    window.localStorage.setItem('monique-gold-catalog-language', language);
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError(false);
    fetch(`/api/public/catalog/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('catalog-not-found');
        return response.json() as Promise<{ catalog: PublicCatalog }>;
      })
      .then((payload) => { if (!cancelled) setCatalog(payload.catalog); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [slug]);

  if (error) {
    return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui' }}>Catálogo novo indisponível.</main>;
  }

  if (!catalog) {
    return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3ede3', color: '#29231e', fontFamily: 'Georgia, serif', fontSize: 24 }}>Preparando tu experiencia…</main>;
  }

  return <GoldCatalogTemplate catalog={catalog} slug={slug} language={language} onLanguageChange={setLanguage} />;
}
