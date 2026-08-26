/**
 * Segundo catálogo independente da Monique — reprodução fiel do site "Beauty Concierge"
 * capturado do cliente (commit `6ee5810` do projeto original, hero "Un momento para vos,
 * un resultado que te acompaña."). Vive em `/catalogo/monique-teste/novo`, isolado do
 * catálogo público existente (`PublicCatalogPage.tsx`, rota `/catalogo/:slug`): conteúdo,
 * estilos e dados aqui são autocontidos e não leem nem escrevem em `knowledge_base`/tenant —
 * uma alteração aqui nunca pode afetar o catálogo antigo, e vice-versa.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, Menu, MessageCircle, ShieldCheck, Sparkles, X } from 'lucide-react';

/** lucide-react 1.x removida os ícones de marca (Instagram incluso) — glifo inline equivalente. */
function InstagramIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

/** Este segundo catálogo mostra sempre o mesmo tenant capturado (Monique) — rota fixa `/catalogo/monique-teste/novo`. */
const CATALOG_SLUG = 'monique-teste';

/** Só como placeholder de contato enquanto o catálogo real ainda não carregou — nunca preço/produto fictício. */
const FALLBACK_INSTAGRAM = 'https://instagram.com/pestanaspormonique';

interface CatalogVariant {
  code: string;
  description?: string;
  price: string;
  durationMinutes?: number;
  whatsappMessage?: string;
}

interface CatalogProduct {
  name: string;
  category?: string;
  description?: string;
  price: string;
  durationMinutes?: number;
  variants?: CatalogVariant[];
}

interface PublicCatalogResponse {
  tenant: { name: string; slug: string };
  contact: {
    whatsappNumber?: string;
    instagramUrl?: string;
    whatsappMessageGeneral?: string;
    whatsappMessageProduct?: string;
  };
  products: CatalogProduct[];
  pixelId?: string;
}

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string };
    _fbq?: Window['fbq'];
  }
}

/** Base code padrão do Meta Pixel — idempotente, mesmo padrão usado no catálogo existente (`PublicCatalogPage.tsx`). */
function loadMetaPixel(pixelId: string): void {
  if (window.fbq) {
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    return;
  }
  const fbq: Window['fbq'] = function (...args: unknown[]) {
    (fbq.queue ??= []).push(args);
  } as Window['fbq'];
  fbq!.queue = [];
  fbq!.loaded = true;
  fbq!.version = '2.0';
  window.fbq = fbq;
  window._fbq = fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
}

function trackWhatsAppContact(): void {
  window.fbq?.('track', 'Contact');
}

function formatDuration(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** Aponta pro backend (`/api/public/catalog/:slug/whatsapp-click`), igual ao catálogo existente: clique é contado de verdade e a mensagem sai com um código de rastreio embutido. */
function whatsappClickUrl(message: string, productName?: string): string {
  const params = new URLSearchParams({ msg: message });
  if (productName) params.set('product', productName);
  return `/api/public/catalog/${encodeURIComponent(CATALOG_SLUG)}/whatsapp-click?${params.toString()}`;
}

const objectives = [
  { id: 'natural', title: 'Quiero verme arreglada sin maquillarme', text: 'Un resultado suave para sentirte linda sin verte producida.', recommendation: 'Lash Lift o Diseño con Hilo' },
  { id: 'practical', title: 'Quiero sentirme lista cada mañana', text: 'Menos tiempo frente al espejo y más tiempo para vos.', recommendation: 'Lash Lift, Browlamination o Combo' },
  { id: 'brows', title: 'Quiero volver a reconocer mi mirada', text: 'Una mirada más equilibrada, sin perder tu expresión.', recommendation: 'Diseño, Henna o Microshading' },
  { id: 'lips', title: 'Quiero recuperar color y definición', text: 'Labios más definidos, con evaluación previa y expectativas reales.', recommendation: 'Microlips o Neutralización' },
];

const resultImages = [
  { src: '/monique-novo/full-face.jpg', alt: 'Resultado real de cejas, pestañas y labios', label: 'Cejas + pestañas' },
  { src: '/monique-novo/brow-lift.jpg', alt: 'Resultado real de brow lift y pestañas', label: 'Brow lift' },
  { src: '/monique-novo/lips-close.jpg', alt: 'Resultado real de labios pigmentados', label: 'Microlips' },
];

export function PublicCatalogMoniqueConcierge() {
  const [step, setStep] = useState(1);
  const [objective, setObjective] = useState('');
  const [previousWork, setPreviousWork] = useState('No');
  const [sensitive, setSensitive] = useState('No');
  const [name, setName] = useState('');
  const [preferredDay, setPreferredDay] = useState('');
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null);
  const [productsError, setProductsError] = useState(false);
  const selectedObjective = useMemo(() => objectives.find((item) => item.id === objective), [objective]);
  const instagramUrl = catalog?.contact.instagramUrl || FALLBACK_INSTAGRAM;

  useEffect(() => {
    const previousTitle = document.title;
    const previousLang = document.documentElement.lang;
    document.title = 'Monique Sorrilha Beauty Studio | Catálogo';
    document.documentElement.lang = 'es-PY';
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light';
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/catalog/${encodeURIComponent(CATALOG_SLUG)}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('fetch failed');
        return response.json() as Promise<{ catalog: PublicCatalogResponse }>;
      })
      .then((payload) => { if (!cancelled) setCatalog(payload.catalog); })
      .catch(() => { if (!cancelled) setProductsError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (catalog?.pixelId) loadMetaPixel(catalog.pixelId);
  }, [catalog?.pixelId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const summary = selectedObjective?.recommendation || 'orientación sobre servicios';
    const text = `Hola Monique, soy ${name}. Mi objetivo es: ${selectedObjective?.title || 'todavía no estoy segura'}. Me interesa: ${summary}. ¿Es mi primera vez? ${previousWork === 'No' ? 'Sí' : 'No'}. ¿Tengo una micropigmentación previa? ${previousWork}. Sensibilidad o alergias: ${sensitive}. Día preferido: ${preferredDay || 'a coordinar'}. ${message}`;
    window.open(whatsappClickUrl(text), '_blank', 'noopener,noreferrer');
    trackWhatsAppContact();
    setSent(true);
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#17202b] concierge-scope">
      <style>{`
        .concierge-scope { --concierge-ink: #17202b; --concierge-muted: #596575; --concierge-blue: #3157d5; --concierge-coral: #e88972; --concierge-pale: #eef2f8; --ease-out: cubic-bezier(.23,1,.32,1); }
        .concierge-scope .container { width: 100%; max-width: 1180px; margin-inline: auto; padding-inline: 24px; }
        .concierge-scope .site-header { position: relative; z-index: 30; background: rgba(247,248,250,.94); border-bottom: 1px solid #e3e7ee; backdrop-filter: blur(16px); }
        .concierge-scope .brand { display: inline-flex; align-items: center; gap: .65rem; color: #17202b; }
        .concierge-scope .brand strong { display: block; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.4rem; font-style: italic; font-weight: 600; line-height: .9; }
        .concierge-scope .brand small { display: block; margin-top: .3rem; color: #7b8796; font-size: .48rem; font-weight: 700; letter-spacing: .18em; }
        .concierge-scope .brand-mark { display: grid; width: 2.15rem; height: 2.15rem; place-items: center; border: 1px solid #3157d5; border-radius: 50%; color: #3157d5; font-family: 'Cormorant Garamond', Georgia, serif; font-size: .95rem; font-style: italic; }
        .concierge-scope .site-header nav a, .concierge-scope .mobile-menu a { transition: color 160ms var(--ease-out); }
        .concierge-scope .site-header nav a:hover, .concierge-scope .mobile-menu a:hover { color: #3157d5; }
        .concierge-scope .header-cta, .concierge-scope .primary-cta, .concierge-scope .next-cta, .concierge-scope .light-cta { align-items: center; justify-content: center; gap: .6rem; border-radius: .45rem; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; transition: transform 160ms var(--ease-out), background-color 160ms var(--ease-out); }
        .concierge-scope .header-cta { padding: .75rem 1rem; background: #3157d5; color: #fff; }
        .concierge-scope .header-cta:hover, .concierge-scope .primary-cta:hover, .concierge-scope .next-cta:hover { background: #2444b6; transform: translateY(-2px); }
        .concierge-scope .mobile-menu { display: flex; flex-direction: column; gap: 1rem; padding: 1rem 0 1.25rem; color: #596575; font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        .concierge-scope .hero { overflow: hidden; background: #f7f8fa; padding: 4rem 0 5rem; }
        .concierge-scope .hero-copy h1, .concierge-scope .section-intro h2, .concierge-scope .section-heading h2, .concierge-scope .contact-section h2 { margin-top: 1.2rem; font-family: 'Cormorant Garamond', Georgia, serif; font-size: clamp(3.4rem, 7vw, 6.8rem); font-weight: 600; letter-spacing: -.055em; line-height: .86; }
        .concierge-scope .hero-copy h1 span, .concierge-scope .section-intro h2 span, .concierge-scope .section-heading h2 span, .concierge-scope .contact-section h2 span { color: #3157d5; font-style: italic; }
        .concierge-scope .kicker { display: inline-flex; align-items: center; gap: .45rem; color: #3157d5; font-size: .67rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
        .concierge-scope .hero-copy > p { max-width: 30rem; margin-top: 1.65rem; color: #596575; font-size: 1rem; line-height: 1.7; }
        .concierge-scope .primary-cta { display: inline-flex; margin-top: 2rem; padding: .95rem 1.15rem; background: #3157d5; color: #fff; }
        .concierge-scope .trust-row { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1.4rem; color: #7b8796; font-size: .66rem; font-weight: 700; }
        .concierge-scope .trust-row span { display: inline-flex; align-items: center; gap: .4rem; }
        .concierge-scope .trust-row svg { color: #e88972; }
        .concierge-scope .hero-visual { position: relative; }
        .concierge-scope .hero-image-wrap { overflow: hidden; border-radius: 1.2rem; box-shadow: 1.1rem 1.1rem 0 #e5eaf2; }
        .concierge-scope .hero-image-wrap img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }
        .concierge-scope .hero-note { position: absolute; bottom: -1rem; left: -1rem; display: flex; align-items: center; gap: .65rem; max-width: 14rem; padding: .8rem 1rem; border: 1px solid #d9e0eb; border-radius: .7rem; background: #fff; box-shadow: 0 .7rem 1.5rem rgba(23,32,43,.08); color: #596575; font-size: .67rem; line-height: 1.35; }
        .concierge-scope .hero-note b { color: #e88972; font-size: 1.4rem; font-family: 'Cormorant Garamond', Georgia, serif; }
        .concierge-scope .triage-section, .concierge-scope .results-section, .concierge-scope .catalog-section { padding: 5.5rem 0; }
        .concierge-scope .triage-section { background: #fff; }
        .concierge-scope .section-number { display: inline-block; color: #e88972; font-size: .72rem; font-weight: 900; letter-spacing: .12em; }
        .concierge-scope .section-number.light { color: #9fb5ff; }
        .concierge-scope .section-intro h2, .concierge-scope .section-heading h2, .concierge-scope .contact-section h2 { font-size: clamp(2.8rem, 5vw, 5rem); }
        .concierge-scope .section-intro > p, .concierge-scope .section-heading > p { max-width: 23rem; margin-top: 1.25rem; color: #697586; font-size: .95rem; line-height: 1.7; }
        .concierge-scope .step-rail { display: grid; gap: .65rem; margin-top: 2.2rem; color: #9aa5b5; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .concierge-scope .step-rail span { border-left: 2px solid #e1e6ee; padding: .35rem 0 .35rem .8rem; }
        .concierge-scope .step-rail .active { border-color: #3157d5; color: #3157d5; }
        .concierge-scope .triage-card { overflow: hidden; border: 1px solid #dde3ec; border-radius: 1rem; background: #f7f8fa; box-shadow: 0 .8rem 2.3rem rgba(39,55,80,.08); }
        .concierge-scope .triage-top { display: flex; align-items: center; gap: 1rem; padding: 1.1rem 1.35rem; border-bottom: 1px solid #e2e7ef; color: #596575; font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .concierge-scope .progress { height: .35rem; flex: 1; overflow: hidden; border-radius: 99px; background: #dce3ed; }
        .concierge-scope .progress i { display: block; height: 100%; border-radius: inherit; background: #e88972; transition: width 220ms var(--ease-out); }
        .concierge-scope .triage-body { padding: 1.4rem; }
        .concierge-scope .triage-body h3 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.3rem; line-height: .95; }
        .concierge-scope .helper { margin-top: .65rem; color: #718093; font-size: .85rem; line-height: 1.5; }
        .concierge-scope .option-grid { display: grid; gap: .7rem; margin-top: 1.5rem; }
        .concierge-scope .option { display: flex; align-items: flex-start; gap: .8rem; padding: 1rem; border: 1px solid #dce3ec; border-radius: .75rem; background: #fff; text-align: left; transition: border-color 160ms var(--ease-out), transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out); }
        .concierge-scope .option:hover { border-color: #9eb0df; transform: translateY(-2px); box-shadow: 0 .5rem 1rem rgba(49,87,213,.08); }
        .concierge-scope .option.selected { border-color: #3157d5; box-shadow: 0 0 0 3px rgba(49,87,213,.12); }
        .concierge-scope .option-icon { display: grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #eef2f8; color: #3157d5; font-size: .75rem; font-weight: 900; }
        .concierge-scope .option.selected .option-icon { background: #3157d5; color: #fff; }
        .concierge-scope .option b, .concierge-scope .option small { display: block; }
        .concierge-scope .option b { color: #263345; font-size: .86rem; }
        .concierge-scope .option small { margin-top: .3rem; color: #7a8797; font-size: .73rem; line-height: 1.35; }
        .concierge-scope .next-cta { display: inline-flex; margin-top: 1.35rem; padding: .9rem 1rem; border: 0; background: #3157d5; color: #fff; }
        .concierge-scope .next-cta:disabled { cursor: not-allowed; opacity: .45; transform: none; }
        .concierge-scope .triage-actions { display: flex; gap: .7rem; margin-top: 1.4rem; }
        .concierge-scope .back-cta { padding: .9rem 1rem; border: 1px solid #d5dce7; border-radius: .45rem; color: #687689; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .concierge-scope .field { display: block; margin-top: 1.15rem; }
        .concierge-scope .field span { display: block; margin-bottom: .45rem; color: #526174; font-size: .7rem; font-weight: 800; }
        .concierge-scope .field input, .concierge-scope .field select, .concierge-scope .field textarea { width: 100%; border: 1px solid #d7dfe9; border-radius: .5rem; background: #fff; padding: .8rem .85rem; color: #263345; outline: none; }
        .concierge-scope .field input:focus, .concierge-scope .field select:focus, .concierge-scope .field textarea:focus { border-color: #3157d5; box-shadow: 0 0 0 3px rgba(49,87,213,.12); }
        .concierge-scope .sent-note { margin-top: 1rem; color: #3157d5; font-size: .78rem; }
        .concierge-scope .results-section { background: #eef2f8; }
        .concierge-scope .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 2rem; }
        .concierge-scope .text-link { display: inline-flex; align-items: center; gap: .45rem; color: #3157d5; font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .concierge-scope .results-grid { display: grid; grid-template-columns: 1.25fr .75fr .75fr; gap: .8rem; margin-top: 2rem; }
        .concierge-scope .result-card { position: relative; min-height: 15rem; overflow: hidden; border-radius: .8rem; background: #dbe2ed; }
        .concierge-scope .result-card.featured { grid-row: span 2; min-height: 31rem; }
        .concierge-scope .result-card img { width: 100%; height: 100%; object-fit: cover; transition: transform 400ms var(--ease-out); }
        .concierge-scope .result-card:hover img { transform: scale(1.04); }
        .concierge-scope .result-card span { position: absolute; bottom: .7rem; left: .7rem; border-radius: .35rem; background: rgba(23,32,43,.82); padding: .4rem .55rem; color: #fff; font-size: .58rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .concierge-scope .catalog-section { background: #fff; }
        .concierge-scope .catalog-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .8rem; margin-top: 2rem; }
        .concierge-scope .service-card { display: flex; min-height: 13rem; flex-direction: column; justify-content: space-between; border: 1px solid #e0e5ed; border-radius: .75rem; background: #f9fafc; padding: 1.15rem; transition: border-color 160ms var(--ease-out), transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out); }
        .concierge-scope .service-card:hover { border-color: #9eb0df; transform: translateY(-3px); box-shadow: 0 .7rem 1.3rem rgba(39,55,80,.08); }
        .concierge-scope .service-meta, .concierge-scope .service-bottom { display: flex; align-items: center; justify-content: space-between; gap: .6rem; }
        .concierge-scope .service-meta { color: #8b97a7; font-size: .58rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .concierge-scope .service-meta span:last-child { display: inline-flex; align-items: center; gap: .25rem; }
        .concierge-scope .service-card h3 { margin-top: 1.4rem; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.8rem; line-height: .95; }
        .concierge-scope .service-card p { margin-top: .55rem; color: #768394; font-size: .75rem; line-height: 1.4; }
        .concierge-scope .service-bottom { margin-top: 1.1rem; border-top: 1px solid #e0e5ed; padding-top: .75rem; }
        .concierge-scope .service-bottom b { color: #3157d5; font-size: .78rem; }
        .concierge-scope .service-bottom a { display: inline-flex; align-items: center; gap: .25rem; color: #596575; font-size: .6rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        .concierge-scope .policy-box { margin-top: 1.2rem; border: 1px solid #dfe5ed; border-radius: .7rem; background: #f7f8fa; padding: 1rem 1.1rem; }
        .concierge-scope .policy-box summary { display: flex; cursor: pointer; align-items: center; justify-content: space-between; color: #445266; font-size: .72rem; font-weight: 800; }
        .concierge-scope .policy-box summary svg { transition: transform 160ms var(--ease-out); }
        .concierge-scope .policy-box[open] summary svg { transform: rotate(180deg); }
        .concierge-scope .policy-box div { color: #718093; font-size: .75rem; line-height: 1.55; margin-top: .85rem; }
        .concierge-scope .policy-box p + p { margin-top: .65rem; }
        .concierge-scope .contact-section { background: #3157d5; padding: 4.5rem 0; color: #fff; }
        .concierge-scope .contact-section h2 { margin-top: 1rem; }
        .concierge-scope .contact-section p { max-width: 27rem; margin-top: 1.1rem; color: #dce5ff; font-size: .92rem; line-height: 1.65; }
        .concierge-scope .light-cta { display: inline-flex; padding: 1rem 1.1rem; background: #fff; color: #3157d5; }
        .concierge-scope .light-cta:hover { transform: translateY(-2px); }
        .concierge-scope .footer { background: #17202b; padding: 1.4rem 0; color: #c7d0dd; font-size: .6rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
        .concierge-scope .footer a:hover { color: #fff; }
        @media (min-width: 640px) { .concierge-scope .option-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
        @media (max-width: 767px) { .concierge-scope .section-heading { align-items: start; flex-direction: column; } .concierge-scope .results-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .concierge-scope .result-card.featured { grid-column: span 2; grid-row: auto; min-height: 22rem; } .concierge-scope .catalog-grid { grid-template-columns: 1fr; } .concierge-scope .hero { padding-top: 2.5rem; } .concierge-scope .hero-note { left: .65rem; } }
      `}</style>

      <header className="site-header">
        <div className="container flex items-center justify-between py-4">
          <a href="#inicio" className="brand" aria-label="Monique Sorrilha Beauty Studio, inicio">
            <span className="brand-mark">MS</span>
            <span><strong>Monique</strong><small>BEAUTY STUDIO</small></span>
          </a>
          <nav className="hidden items-center gap-7 text-[10px] font-bold uppercase tracking-[.14em] text-[#596575] md:flex">
            <a href="#triagem">Triagem</a>
            <a href="#servicios">Servicios</a>
            <a href="#resultados">Resultados</a>
          </nav>
          <a href="#triagem" className="header-cta hidden md:inline-flex">Encontrar mi servicio <ArrowRight size={14} /></a>
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <div className="container mobile-menu md:hidden">
            <a href="#triagem" onClick={() => setMenuOpen(false)}>Triagem</a>
            <a href="#servicios" onClick={() => setMenuOpen(false)}>Servicios</a>
            <a href="#resultados" onClick={() => setMenuOpen(false)}>Resultados</a>
          </div>
        )}
      </header>

      <section id="inicio" className="hero">
        <div className="container grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div className="hero-copy">
            <span className="kicker"><Sparkles size={14} /> Beauty Concierge para vos · Luque</span>
            <h1>Un momento para vos, <span>un resultado que te acompaña.</span></h1>
            <p>Entre trabajo, compromisos y mil pendientes, también merecés sentirte lista sin pasar horas frente al espejo. Encontrá tu servicio en menos de un minuto.</p>
            <a href="#triagem" className="primary-cta">Encontrar mi servicio <ArrowRight size={16} /></a>
            <div className="trust-row">
              <span><ShieldCheck size={15} /> Cuidado y evaluación</span>
              <span><Clock3 size={15} /> Más tiempo para vos</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-image-wrap"><img src="/monique-novo/full-face.jpg" alt="Resultado real de belleza natural" /></div>
            <div className="hero-note"><b>01</b><span>Elegir bien también es parte del cuidado.</span></div>
          </div>
        </div>
      </section>

      <section id="triagem" className="triage-section">
        <div className="container grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:items-start">
          <div className="section-intro">
            <span className="section-number">01</span>
            <h2>Antes de elegir,<br /><span>entendemos lo que necesitás.</span></h2>
            <p>Tres preguntas breves para que recibas una orientación clara, respetuosa y pensada para vos.</p>
            <div className="step-rail">
              <span className={step >= 1 ? 'active' : ''}>01 Objetivo</span>
              <span className={step >= 2 ? 'active' : ''}>02 Contexto</span>
              <span className={step >= 3 ? 'active' : ''}>03 Contacto</span>
            </div>
          </div>
          <div className="triage-card">
            <div className="triage-top">
              <span>Paso {step} de 3</span>
              <div className="progress"><i style={{ width: `${(step / 3) * 100}%` }} /></div>
            </div>
            {step === 1 && (
              <div className="triage-body">
                <h3>¿Qué querés regalarte hoy?</h3>
                <p className="helper">Pensá en cómo querés salir del estudio y elegí la opción que más se acerca a vos.</p>
                <div className="option-grid">
                  {objectives.map((item) => (
                    <button key={item.id} onClick={() => setObjective(item.id)} className={objective === item.id ? 'option selected' : 'option'}>
                      <span className="option-icon">{objective === item.id ? <Check size={17} /> : item.id === 'natural' ? 'N' : item.id === 'practical' ? 'T' : item.id === 'brows' ? 'C' : 'L'}</span>
                      <span><b>{item.title}</b><small>{item.text}</small></span>
                    </button>
                  ))}
                </div>
                <button disabled={!objective} onClick={() => setStep(2)} className="next-cta">Continuar <ArrowRight size={16} /></button>
              </div>
            )}
            {step === 2 && (
              <div className="triage-body">
                <h3>Dos respuestas para orientarte mejor.</h3>
                <p className="helper">Estas preguntas ayudan a evitar recomendaciones inadecuadas.</p>
                <label className="field">
                  <span>¿Tenés una micropigmentación previa?</span>
                  <select value={previousWork} onChange={(event) => setPreviousWork(event.target.value)}>
                    <option>No</option>
                    <option>Sí, en cejas</option>
                    <option>Sí, en labios</option>
                    <option>No estoy segura</option>
                  </select>
                </label>
                <label className="field">
                  <span>¿Tenés sensibilidad o alergias que debamos conocer?</span>
                  <select value={sensitive} onChange={(event) => setSensitive(event.target.value)}>
                    <option>No</option>
                    <option>Sí</option>
                    <option>No estoy segura</option>
                  </select>
                </label>
                <div className="triage-actions">
                  <button onClick={() => setStep(1)} className="back-cta">Volver</button>
                  <button onClick={() => setStep(3)} className="next-cta">Continuar <ArrowRight size={16} /></button>
                </div>
              </div>
            )}
            {step === 3 && (
              <form onSubmit={submit} className="triage-body">
                <h3>Listo. Conversemos con contexto.</h3>
                <p className="helper">Te enviaremos la información de tu triagem junto con tu mensaje.</p>
                <label className="field">
                  <span>Tu nombre</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="¿Cómo te llamamos?" />
                </label>
                <label className="field">
                  <span>Día preferido</span>
                  <input type="text" value={preferredDay} onChange={(event) => setPreferredDay(event.target.value)} placeholder="Ej.: martes por la tarde" />
                </label>
                <label className="field">
                  <span>¿Hay algo más que quieras contarnos?</span>
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tu rutina, una duda o el resultado que imaginás..." rows={3} />
                </label>
                <div className="triage-actions">
                  <button type="button" onClick={() => setStep(2)} className="back-cta">Volver</button>
                  <button type="submit" className="next-cta">Enviar mi triagem <MessageCircle size={16} /></button>
                </div>
                {sent && <p className="sent-note">Tu mensaje fue preparado en WhatsApp. La confirmación del horario depende de la agenda.</p>}
              </form>
            )}
          </div>
        </div>
      </section>

      <section id="resultados" className="results-section">
        <div className="container">
          <div className="section-heading">
            <div><span className="section-number">02</span><h2>Resultados reales,<br /><span>expectativas honestas.</span></h2></div>
            <a href={instagramUrl} target="_blank" rel="noreferrer" className="text-link"><InstagramIcon /> Ver Instagram</a>
          </div>
          <div className="results-grid">
            {resultImages.map((image, index) => (
              <a key={image.src} href={instagramUrl} target="_blank" rel="noreferrer" className={index === 0 ? 'result-card featured' : 'result-card'}>
                <img src={image.src} alt={image.alt} />
                <span>{image.label}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="servicios" className="catalog-section">
        <div className="container">
          <div className="section-heading">
            <div><span className="section-number">03</span><h2>Catálogo claro.<br /><span>Elegí con confianza.</span></h2></div>
            <p>Precios, duración y objetivo de cada servicio en una sola vista.</p>
          </div>
          {!catalog && !productsError && <p className="helper">Cargando servicios y precios...</p>}
          {productsError && <p className="helper">No se pudieron cargar los servicios en este momento. Probá de nuevo en unos minutos.</p>}
          {catalog && (
            <div className="catalog-grid">
              {catalog.products.map((service) => {
                const consultMessage = catalog.contact.whatsappMessageProduct
                  ? catalog.contact.whatsappMessageProduct.split('{produto}').join(service.name)
                  : `Hola Monique, me interesa ${service.name}. Quiero saber si es para mí.`;
                return (
                  <article className="service-card" key={service.name}>
                    <div className="service-meta">
                      <span>{service.category || 'Servicios'}</span>
                      {formatDuration(service.durationMinutes) && <span><Clock3 size={12} /> {formatDuration(service.durationMinutes)}</span>}
                    </div>
                    <h3>{service.name}</h3>
                    {service.description && <p>{service.description}</p>}
                    <div className="service-bottom">
                      <b>{service.price}</b>
                      <a href={whatsappClickUrl(consultMessage, service.name)} target="_blank" rel="noreferrer" onClick={trackWhatsAppContact}>Consultar <ArrowRight size={13} /></a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <details className="policy-box">
            <summary>Información importante antes de confirmar <ChevronDown size={16} /></summary>
            <div>
              <p><b>Seña:</b> Gs 50.000, descontada del total. <b>Agenda:</b> el horario se confirma después de revisar disponibilidad y comprobante.</p>
              <p><b>Micropigmentación:</b> la técnica se define en evaluación presencial. <b>Cancelaciones:</b> devolución de seña a partir de 24 h de anticipación. Tolerancia de atraso de 15 minutos.</p>
            </div>
          </details>
        </div>
      </section>

      <section id="contacto" className="contact-section">
        <div className="container flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div>
            <span className="section-number light">04</span>
            <h2>Un rato para vos.<br /><span>Un resultado que te acompaña.</span></h2>
            <p>Si todavía tenés dudas, la triagem te ayuda a encontrar un punto de partida pensado para tu rutina.</p>
          </div>
          <a href="#triagem" className="light-cta">Volver a la triagem <ArrowRight size={16} /></a>
        </div>
      </section>
      <footer className="footer">
        <div className="container flex flex-col justify-between gap-3 sm:flex-row">
          <span>Monique Sorrilha Beauty Studio</span>
          <span>Luque · Paraguay</span>
          <a href={instagramUrl} target="_blank" rel="noreferrer">@pestanaspormonique</a>
        </div>
      </footer>
    </main>
  );
}

export default PublicCatalogMoniqueConcierge;
