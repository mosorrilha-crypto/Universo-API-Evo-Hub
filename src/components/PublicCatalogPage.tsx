/**
 * Direção visual: Operação Serena — cada variação deve ter contexto próprio,
 * com leitura leve e sem duplicar a explicação geral da família de serviços.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { GoldCatalogTemplate } from './GoldCatalogTemplate';

// Design direction: Atelier Bilíngue — editorial, sereno e acolhedor; conteúdo essencial
// aparece antes dos dados dinâmicos e a escolha ES/PT é imediata, discreta e acessível.

interface PublicCatalogVariant {
  code: string;
  description?: string;
  imageUrl?: string;
  whatsappMessage?: string;
  beforeAfter?: PublicBeforeAfterPair[];
  dimensions?: string;
  litros?: number;
  price: string;
  priceAmount?: number;
  durationMinutes?: number;
}

export interface PublicCatalogProduct {
  name: string;
  category?: string;
  description?: string;
  price: string;
  priceAmount?: number;
  currency: string;
  durationMinutes?: number;
  variants?: PublicCatalogVariant[];
  /** Miniatura comprimida (data URI JPEG) — gerada no backend a partir da foto de exemplo do produto, quando existir. */
  imageUrl?: string;
  beforeAfter?: PublicBeforeAfterPair[];
}

interface PublicBeforeAfterPair {
  id: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  caption?: string;
}

type CatalogTemplate = 'default' | 'beauty_concierge' | 'gold_catalog';

export interface PublicCatalog {
  tenant: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
    template?: CatalogTemplate;
  };
  contact: {
    whatsappNumber?: string;
    instagramUrl?: string;
    locationMapsUrl?: string;
    addressLabel?: string;
    hoursLabel?: string;
    whatsappMessageGeneral?: string;
    whatsappMessageProduct?: string;
  };
  products: PublicCatalogProduct[];
  pixelId?: string;
}

interface PublicCatalogPageProps {
  slug: string;
}

export type CatalogLanguage = 'es' | 'pt';

const LANGUAGE_STORAGE_KEY = 'monique-catalog-language';

const COPY = {
  es: {
    documentTitle: 'Catálogo',
    languageLabel: 'Idioma del catálogo',
    headerCta: 'Ver servicios',
    heroEyebrow: 'Estudio de micropigmentación · Luque, Paraguay',
    heroTitle: 'Un trazo que no se nota como retoque.',
    heroSub: 'Técnica brasileña en labios y cejas. Resultado natural, ambiente privado, sin apuro.',
    heroCta: 'Ver servicios y precios',
    loadingEyebrow: 'Preparando tu experiencia',
    loadingTitle: 'Estamos organizando los servicios y precios para vos.',
    loadingCopy: 'En un instante vas a poder elegir con calma el servicio que mejor acompaña tu rutina.',
    loadingStatus: 'Cargando servicios',
    trust: [
      ['13 años', 'de experiencia'],
      ['Técnica brasileña', 'en labios y cejas'],
      ['Ambiente privado', 'y sensorial'],
      ['Anestésico tópico', 'cuando corresponde'],
    ],
    processEyebrow: 'Cómo funciona',
    processTitle: 'De la duda al resultado, en tres pasos.',
    steps: [
      ['Escribís', 'Nos contás qué buscás, sin compromiso ni apuro.'],
      ['Diseñamos juntas', 'Definimos el resultado antes de empezar, a tu gusto.'],
      ['Te vas lista', 'Con el resultado terminado, el mismo día.'],
    ],
    servicesEyebrow: 'Servicios',
    servicesTitle: 'Elegí el servicio que mejor acompaña tu rutina.',
    from: 'Desde',
    variantsOf: 'Variantes de',
    whatsappProduct: 'Consultar por WhatsApp',
    whatsappGeneral: 'Hola, quiero información sobre los servicios.',
    whatsappWithProduct: (product: string) => `Hola, quiero información sobre ${product}.`,
    beforeAfter: 'Antes y después',
    before: 'Antes',
    after: 'Después',
    faqEyebrow: 'Antes de escribir',
    faqTitle: 'Las preguntas que todas hacen',
    footerMap: 'Cómo llegar',
    stickyWhatsapp: 'Escribinos por WhatsApp',
    unavailableTitle: 'Catálogo no disponible',
    unavailableCopy: 'Este catálogo no está disponible en este momento. Volvé a intentar en unos minutos.',
    fetchError: 'No se pudo cargar el catálogo.',
    missingError: 'Catálogo no encontrado.',
  },
  pt: {
    documentTitle: 'Catálogo',
    languageLabel: 'Idioma do catálogo',
    headerCta: 'Ver serviços',
    heroEyebrow: 'Estúdio de micropigmentação · Luque, Paraguai',
    heroTitle: 'Um traço que não parece retoque.',
    heroSub: 'Técnica brasileira em lábios e sobrancelhas. Resultado natural, ambiente privado e sem pressa.',
    heroCta: 'Ver serviços e preços',
    loadingEyebrow: 'Preparando sua experiência',
    loadingTitle: 'Estamos organizando os serviços e preços para você.',
    loadingCopy: 'Em instantes, você poderá escolher com calma o serviço que melhor acompanha sua rotina.',
    loadingStatus: 'Carregando serviços',
    trust: [
      ['13 anos', 'de experiência'],
      ['Técnica brasileira', 'em lábios e sobrancelhas'],
      ['Ambiente privativo', 'e sensorial'],
      ['Anestésico tópico', 'quando necessário'],
    ],
    processEyebrow: 'Como funciona',
    processTitle: 'Da dúvida ao resultado, em três passos.',
    steps: [
      ['Você escreve', 'Conta o que procura, sem compromisso e sem pressa.'],
      ['Criamos juntas', 'Definimos o resultado antes de começar, do seu jeito.'],
      ['Você sai pronta', 'Com o resultado finalizado no mesmo dia.'],
    ],
    servicesEyebrow: 'Serviços',
    servicesTitle: 'Escolha o serviço que melhor acompanha sua rotina.',
    from: 'A partir de',
    variantsOf: 'Variações de',
    whatsappProduct: 'Consultar pelo WhatsApp',
    whatsappGeneral: 'Olá, quero informações sobre os serviços.',
    whatsappWithProduct: (product: string) => `Olá, quero informações sobre ${product}.`,
    beforeAfter: 'Antes e depois',
    before: 'Antes',
    after: 'Depois',
    faqEyebrow: 'Antes de escrever',
    faqTitle: 'As perguntas que todas fazem',
    footerMap: 'Como chegar',
    stickyWhatsapp: 'Fale conosco pelo WhatsApp',
    unavailableTitle: 'Catálogo indisponível',
    unavailableCopy: 'Este catálogo não está disponível neste momento. Tente novamente em alguns minutos.',
    fetchError: 'Não foi possível carregar o catálogo.',
    missingError: 'Catálogo não encontrado.',
  },
} as const;

const FAQS = {
  es: [
    {
      question: '¿Duele?',
      answer: 'Se siente, pero la sensación depende mucho de la sensibilidad de cada persona. Usamos anestésico tópico cuando corresponde y conversamos todo antes de empezar.',
    },
    {
      question: '¿Se va a ver artificial?',
      answer: 'No. El objetivo es que el resultado respete tu rostro y se vea natural. La recomendación final depende de una evaluación personalizada.',
    },
    {
      question: '¿Cuánto dura?',
      answer: 'La duración depende del procedimiento, tu piel y tus cuidados posteriores. Te explicamos los detalles antes de agendar.',
    },
    {
      question: '¿Hay contraindicaciones?',
      answer: 'Sí, algunas condiciones requieren evaluación previa. Escribinos antes de agendar para orientarte con seguridad.',
    },
  ],
  pt: [
    {
      question: 'Dói?',
      answer: 'É possível sentir o procedimento, mas a sensação depende bastante da sensibilidade de cada pessoa. Usamos anestésico tópico quando necessário e explicamos tudo antes de começar.',
    },
    {
      question: 'O resultado ficará artificial?',
      answer: 'Não. O objetivo é respeitar os seus traços e manter um resultado natural. A recomendação final depende de uma avaliação personalizada.',
    },
    {
      question: 'Quanto tempo dura?',
      answer: 'A duração depende do procedimento, da sua pele e dos cuidados posteriores. Explicamos os detalhes antes do agendamento.',
    },
    {
      question: 'Existem contraindicações?',
      answer: 'Sim. Algumas condições pedem avaliação prévia. Fale conosco antes de agendar para receber uma orientação segura.',
    },
  ],
} as const;

// Traduções específicas dos conteúdos já publicados no catálogo Monique. Para conteúdos
// novos sem correspondência, a página mantém o dado original em vez de inventar uma tradução.
const PT_CATALOG_TEXT: Record<string, string> = {
  Pestañas: 'Cílios',
  Cejas: 'Sobrancelhas',
  Labios: 'Lábios',
  'Cejas — Diseño & Tratamientos': 'Sobrancelhas — Design e Tratamentos',
  'Cejas Microshading o Microblading': 'Sobrancelhas: Microshading ou Microblading',
  'Microlips Labios': 'Microlips Lábios',
  Neutralización: 'Neutralização',
  Retoque: 'Retoque',
  'Combo Micro Cejas + Labios': 'Combo Micro Sobrancelhas + Lábios',
  'Combo Micro Cejas + Pestañas': 'Combo Micro Sobrancelhas + Cílios',
  'Combo Pestañas + Micro Labios': 'Combo Cílios + Micro Lábios',
  'Combo Full Face con Micro de Cejas + Labios y Pestañas': 'Combo Full Face com Micro de Sobrancelhas + Lábios e Cílios',
  'Extensiones y lifting de pestañas — 7 efectos diferentes, elegí según el look que buscás: Lash Lift (natural, sin extensión), Efecto Volumen Brasileño (técnica clásica del estudio, volumen marcado), Volumen Brasileño Marrones (tono marrón, discreto), Efecto Rímel (volumen leve, para el día a día), Efecto Delineado (línea concentrada, sutil), Efecto Foxy (personalizado según la forma del rostro), Efecto 30+ (retención de hasta 30 días, máximo volumen).': 'Extensões e lifting de cílios — 7 efeitos diferentes para escolher conforme o visual que você procura: Lash Lift (natural, sem extensão), Efeito Volume Brasileiro (técnica clássica do estúdio, volume marcante), Volume Brasileiro Marrom (tom marrom e discreto), Efeito Rímel (volume leve para o dia a dia), Efeito Delineado (linha concentrada e sutil), Efeito Foxy (personalizado conforme o formato do rosto) e Efeito 30+ (retenção de até 30 dias e volume máximo).',
  'Diseño y tratamientos de cejas no permanentes — elegí según el objetivo: Diseño Tradicional con Hilo (depilación de precisión con hilo), Diseño con Henna (dibujo temporal, ideal para probar la forma antes de algo permanente), Coloración (tinte para emparejar el color de los pelitos), Browlamination (peina y fija los pelitos hacia arriba, efecto full por ~3 semanas), Browlamination + Coloración (combina las dos técnicas).': 'Design e tratamentos de sobrancelhas não permanentes — escolha conforme seu objetivo: Design Tradicional com Linha (remoção precisa com linha), Design com Henna (desenho temporário, ideal para testar o formato antes de algo permanente), Coloração (tintura para uniformizar a cor dos fios), Brow Lamination (penteia e fixa os fios para cima, com efeito cheio por cerca de 3 semanas) e Brow Lamination + Coloração (combina as duas técnicas).',
  'Micropigmentación de cejas — elegí entre Microshading (efecto maquillada, sombra suave en polvo, dura más en piel grasa), Microblading (pelo a pelo hiperrealista, indicado para piel seca/normal con poros cerrados) o Técnica Híbrida (microblading al inicio de la ceja, microshading al final). La decisión de la técnica se hace en la evaluación presencial.': 'Micropigmentação de sobrancelhas — escolha entre Microshading (efeito maquiado, sombra suave em pó e maior duração em pele oleosa), Microblading (fio a fio hiper-realista, indicado para pele seca ou normal com poros fechados) ou Técnica Híbrida (microblading no início da sobrancelha e microshading no final). A técnica é definida na avaliação presencial.',
  'Color natural y definido, sin depender tanto del labial.': 'Cor natural e definida, sem depender tanto do batom.',
  'Corrige tonos no deseados de una micropigmentación labial anterior.': 'Corrige tons indesejados de uma micropigmentação labial anterior.',
  'Cejas y labios en la misma sesión.': 'Sobrancelhas e lábios na mesma sessão.',
  'Cejas y pestañas en la misma sesión.': 'Sobrancelhas e cílios na mesma sessão.',
  'Pestañas y labios en la misma sesión.': 'Cílios e lábios na mesma sessão.',
  'Cejas, labios y pestañas en la misma sesión.': 'Sobrancelhas, lábios e cílios na mesma sessão.',
  'NO incluido en el valor inicial, no es necesario para todas las clientas — solo cuando Monique lo recomienda después de evaluar el resultado.': 'NÃO está incluído no valor inicial e não é necessário para todas as clientes — apenas quando Monique recomenda depois de avaliar o resultado.',
  'Lash Lift': 'Lash Lift',
  'Efecto Volumen Brasileño': 'Efeito Volume Brasileiro',
  'Volumen Brasileño Marrones': 'Volume Brasileiro Marrom',
  'Efecto Rímel': 'Efeito Rímel',
  'Efecto Delineado': 'Efeito Delineado',
  'Efecto Foxy': 'Efeito Foxy',
  'Efecto 30+': 'Efeito 30+',
  'Diseño Tradicional con Hilo': 'Design Tradicional com Linha',
  'Diseño con Henna': 'Design com Henna',
  Coloración: 'Coloração',
  Browlamination: 'Brow Lamination',
  'Browlamination + Coloración': 'Brow Lamination + Coloração',
};

function normalizeSpanishText(value: string): string {
  return value
    .replaceAll('varia por efeito', 'varía según el efecto')
    .replaceAll('varia pela técnica', 'varía según la técnica')
    .replaceAll('varia por efecto', 'varía según el efecto');
}

function localizeCatalogText(value: string | undefined, language: CatalogLanguage): string {
  if (!value) return '';
  return language === 'pt' ? (PT_CATALOG_TEXT[value] || value) : normalizeSpanishText(value);
}

/**
 * Aponta pro backend (`/api/public/catalog/:slug/whatsapp-click`) em vez de
 * direto pro `wa.me` — pedido real (25/08/2026): assim o clique é contado
 * de verdade (independente de Meta Pixel) e a mensagem sai com um código
 * curto de emojis embutido, que o agente reconhece na mensagem recebida
 * pra ligar a conversa a este clique específico com certeza.
 */
function whatsappUrl(slug: string, phone: string | undefined, productName: string | undefined, template: string | undefined, language: CatalogLanguage): string | null {
  if (!phone) return null;
  const copy = COPY[language];
  const defaultMessage = productName ? copy.whatsappWithProduct(productName) : copy.whatsappGeneral;
  const message = language === 'es' && template
    ? (productName ? template.split('{produto}').join(productName) : template)
    : defaultMessage;
  const params = new URLSearchParams({ msg: message });
  if (productName) params.set('product', productName);
  return `/api/public/catalog/${encodeURIComponent(slug)}/whatsapp-click?${params.toString()}`;
}

function formatDuration(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function formatProductPrice(product: PublicCatalogProduct, language: CatalogLanguage): string {
  if (!product.price) return language === 'pt' ? 'Consultar' : 'Consultar';
  return localizeCatalogText(product.price, language);
}

function BeforeAfterGallery({ pairs, language, title }: { pairs: PublicBeforeAfterPair[]; language: CatalogLanguage; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [reveal, setReveal] = useState(50);
  const copy = COPY[language];
  const pair = pairs[Math.min(activeIndex, pairs.length - 1)];

  if (!pair) return null;

  return (
    <section className="before-after-gallery" aria-label={`${copy.beforeAfter}: ${title}`}>
      <div className="before-after-heading"><span>{copy.beforeAfter}</span><em>{title}</em></div>
      <div className="before-after-stage">
        <img src={pair.beforeImageUrl} alt={`${copy.before}: ${title}`} loading="lazy" />
        <img className="before-after-overlay" src={pair.afterImageUrl} alt={`${copy.after}: ${title}`} loading="lazy" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }} />
        <span className="before-after-line" style={{ left: `${reveal}%` }} aria-hidden="true" />
        <span className="before-after-label before-label">{copy.before}</span>
        <span className="before-after-label after-label">{copy.after}</span>
        <input
          className="before-after-range"
          type="range"
          min="0"
          max="100"
          value={reveal}
          onChange={(event) => setReveal(Number(event.target.value))}
          aria-label={`${copy.beforeAfter}: ${title}`}
        />
      </div>
      {pair.caption && <p className="before-after-caption">{localizeCatalogText(pair.caption, language)}</p>}
      {pairs.length > 1 && (
        <div className="before-after-pagination" aria-label={`${copy.beforeAfter}: ${title}`}>
          {pairs.map((item, index) => <button key={item.id} type="button" onClick={() => { setActiveIndex(index); setReveal(50); }} aria-label={`${copy.beforeAfter} ${index + 1}`} aria-current={index === activeIndex}>{index + 1}</button>)}
        </div>
      )}
    </section>
  );
}

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string };
    _fbq?: Window['fbq'];
  }
}

/**
 * Base code padrão do Meta Pixel, injetada só uma vez (idempotente — várias
 * chamadas com o mesmo pixelId, ex: StrictMode rodando o effect 2x, não
 * duplicam o <script> nem re-inicializam). Fecha o funil desde o clique no
 * anúncio: sem isso, uma campanha que manda tráfego pra este catálogo em vez
 * de Clique-para-WhatsApp direto não tinha nenhum sinal de conversão real
 * pra Meta otimizar, só visualização de página (ver publicCatalogStore.ts).
 */
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

/** Clique num botão de WhatsApp do catálogo = intenção real de contato — evento padrão do Meta, não custom, pra poder ser usado direto como meta de otimização numa campanha. No-op silencioso se o tenant não tem pixel configurado. */
function trackWhatsAppContact(): void {
  window.fbq?.('track', 'Contact');
}

export function PublicCatalogPage({ slug }: PublicCatalogPageProps) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState(0);
  const [language, setLanguage] = useState<CatalogLanguage>(() => {
    if (typeof window === 'undefined') return 'es';
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'pt' ? 'pt' : 'es';
  });
  const copy = COPY[language];

  useLayoutEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : 'es-PY';
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    if (!catalog) return undefined;
    const previousTitle = document.title;
    document.title = `${catalog.tenant.name} | ${copy.documentTitle}`;
    return () => { document.title = previousTitle; };
  }, [catalog, copy.documentTitle]);

  useEffect(() => {
    if (catalog?.pixelId) loadMetaPixel(catalog.pixelId);
  }, [catalog?.pixelId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/public/catalog/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? copy.missingError : copy.fetchError);
        return response.json() as Promise<{ catalog: PublicCatalog }>;
      })
      .then((payload) => { if (!cancelled) setCatalog(payload.catalog); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : copy.fetchError);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const groupedProducts = useMemo(() => {
    const groups = new Map<string, PublicCatalogProduct[]>();
    for (const product of catalog?.products || []) {
      const category = product.category?.trim() || (language === 'pt' ? 'Serviços' : 'Servicios');
      const items = groups.get(category) || [];
      items.push(product);
      groups.set(category, items);
    }
    return [...groups.entries()];
  }, [catalog?.products, language]);

  if (loading) return <CatalogLoadingPage language={language} onLanguageChange={setLanguage} />;

  if (error || !catalog) {
    return (
      <PageShell>
        <CatalogHeader catalogName="Monique — Pestañas por Monique" language={language} onLanguageChange={setLanguage} />
        <div className="catalog-state">
          <span className="eyebrow">{copy.loadingEyebrow}</span>
          <h1>{copy.unavailableTitle}</h1>
          <p>{copy.unavailableCopy}</p>
        </div>
      </PageShell>
    );
  }

  const generalWhatsapp = whatsappUrl(slug, catalog.contact.whatsappNumber, undefined, catalog.contact.whatsappMessageGeneral, language);
  const faqs = FAQS[language];

  if (catalog.tenant.template === 'gold_catalog') {
    return <GoldCatalogTemplate catalog={catalog} slug={slug} language={language} onLanguageChange={setLanguage} />;
  }

  return (
    <PageShell template={catalog.tenant.template}>
      <CatalogHeader catalogName={catalog.tenant.name} language={language} onLanguageChange={setLanguage} />
      <main id="inicio">
        <section className="catalog-hero">
          <div className="catalog-wrap hero-inner">
            <span className="eyebrow">{copy.heroEyebrow}</span>
            <h1>{copy.heroTitle}</h1>
            <div className="hero-stroke" aria-hidden="true" />
            <p className="hero-sub">{copy.heroSub}</p>
            <a className="hero-link" href="#servicios">{copy.heroCta} <span aria-hidden="true">↓</span></a>
          </div>
        </section>

        <TrustBand language={language} />

        <section className="steps-section">
          <div className="catalog-wrap">
            <span className="eyebrow">{copy.processEyebrow}</span>
            <h2>{copy.processTitle}</h2>
            <div className="steps-grid">
              {copy.steps.map(([title, text], index) => (
                <div key={`step-${index}`}><Step number={`0${index + 1}`} title={title} text={text} /></div>
              ))}
            </div>
          </div>
        </section>

        <section className="services-section" id="servicios">
          <div className="catalog-wrap">
            <span className="eyebrow">{copy.servicesEyebrow}</span>
            <h2>{copy.servicesTitle}</h2>
            <div className="product-groups">
              {groupedProducts.map(([category, products]) => (
                <section className="product-group" key={category}>
                  <h3 className="group-title">{localizeCatalogText(category, language)}</h3>
                  <div className="product-grid">
                    {products.map((product) => {
                      const localizedName = localizeCatalogText(product.name, language);
                      const productWhatsapp = whatsappUrl(slug, catalog.contact.whatsappNumber, localizedName, catalog.contact.whatsappMessageProduct, language);
                      return (
                        <article className={`product-card${product.imageUrl ? ' has-image' : ''}`} key={`${category}-${product.name}`}>
                          {product.imageUrl && <img className="product-card-image" src={product.imageUrl} alt={localizedName} loading="lazy" />}
                          <div className="product-card-body">
                            <div className="product-topline">
                              <span className="product-dot" aria-hidden="true" />
                              {formatDuration(product.durationMinutes) && <span>{formatDuration(product.durationMinutes)}</span>}
                            </div>
                            <h4>{localizedName}</h4>
                            <div className="price-row"><strong>{formatProductPrice(product, language)}</strong><span>{copy.from}</span></div>
                            {product.description && <p>{localizeCatalogText(product.description, language)}</p>}
                            {product.beforeAfter?.length ? <BeforeAfterGallery pairs={product.beforeAfter} language={language} title={localizedName} /> : null}
                            {product.variants && product.variants.length > 0 && (
                              <div className="variants" aria-label={`${copy.variantsOf} ${localizedName}`}>
                                {product.variants.map((variant) => {
                                  const localizedVariantName = localizeCatalogText(variant.code, language);
                                  const variantWhatsapp = whatsappUrl(slug, catalog.contact.whatsappNumber, `${localizedName} — ${localizedVariantName}`, variant.whatsappMessage || catalog.contact.whatsappMessageProduct, language);
                                  return (
                                  <div className="variant-row" key={variant.code}>
                                    <div>
                                      {variant.imageUrl && <img className="variant-image" src={variant.imageUrl} alt={localizedVariantName} loading="lazy" />}
                                      <span className="variant-name">{localizeCatalogText(variant.code, language)}</span>
                                      {variant.description && <p className="variant-description">{localizeCatalogText(variant.description, language)}</p>}
                                      {variant.beforeAfter?.length ? <BeforeAfterGallery pairs={variant.beforeAfter} language={language} title={localizedVariantName} /> : null}
                                      {variantWhatsapp && <a className="variant-whatsapp" href={variantWhatsapp} target="_blank" rel="noreferrer">{copy.whatsappProduct} <span aria-hidden="true">↗</span></a>}
                                    </div>
                                    <strong>{localizeCatalogText(variant.price, language)}</strong>
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                            {productWhatsapp && <a className="whatsapp-button" href={productWhatsapp} target="_blank" rel="noreferrer" onClick={trackWhatsAppContact}>{copy.whatsappProduct} <span aria-hidden="true">↗</span></a>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="faq-section">
          <div className="catalog-wrap faq-inner">
            <span className="eyebrow">{copy.faqEyebrow}</span>
            <div>
              <h2>{copy.faqTitle}</h2>
              <div className="faq-list">
                {faqs.map((faq, index) => {
                  const isOpen = openFaq === index;
                  return (
                    <div className={`faq-item${isOpen ? ' is-open' : ''}`} key={faq.question}>
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpenFaq(isOpen ? -1 : index)}>
                        <span>{faq.question}</span><span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                      </button>
                      {isOpen && <p>{faq.answer}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="catalog-footer">
        <div className="catalog-wrap footer-grid">
          <div>
            <p className="footer-brand">{catalog.tenant.name}</p>
            {catalog.contact.addressLabel && <p>{catalog.contact.addressLabel}</p>}
            {catalog.contact.hoursLabel && <p>{catalog.contact.hoursLabel}</p>}
          </div>
          <div className="footer-links">
            {generalWhatsapp && <a href={generalWhatsapp} target="_blank" rel="noreferrer" onClick={trackWhatsAppContact}>WhatsApp</a>}
            {catalog.contact.instagramUrl && <a href={catalog.contact.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
            {catalog.contact.locationMapsUrl && <a href={catalog.contact.locationMapsUrl} target="_blank" rel="noreferrer">{copy.footerMap}</a>}
          </div>
        </div>
      </footer>

      {generalWhatsapp && <a className="sticky-whatsapp" href={generalWhatsapp} target="_blank" rel="noreferrer" onClick={trackWhatsAppContact}>{copy.stickyWhatsapp} <span aria-hidden="true">↗</span></a>}
    </PageShell>
  );
}

function CatalogLoadingPage({ language, onLanguageChange }: { language: CatalogLanguage; onLanguageChange: (language: CatalogLanguage) => void }) {
  const copy = COPY[language];
  return (
    <PageShell>
      <CatalogHeader catalogName="Monique — Pestañas por Monique" language={language} onLanguageChange={onLanguageChange} />
      <main id="inicio" aria-busy="true" aria-live="polite">
        <section className="catalog-hero">
          <div className="catalog-wrap hero-inner">
            <span className="eyebrow">{copy.heroEyebrow}</span>
            <h1>{copy.heroTitle}</h1>
            <div className="hero-stroke" aria-hidden="true" />
            <p className="hero-sub">{copy.heroSub}</p>
            <a className="hero-link" href="#servicios">{copy.heroCta} <span aria-hidden="true">↓</span></a>
          </div>
        </section>
        <TrustBand language={language} />
        <section className="services-section loading-services" id="servicios">
          <div className="catalog-wrap">
            <span className="eyebrow">{copy.loadingEyebrow}</span>
            <h2>{copy.loadingTitle}</h2>
            <p className="loading-copy">{copy.loadingCopy}</p>
            <div className="loading-status"><span className="loading-orb" aria-hidden="true" />{copy.loadingStatus}</div>
            <div className="product-grid loading-grid" aria-hidden="true">
              {[0, 1, 2].map((card) => (
                <div className="product-card skeleton-card" key={card}>
                  <span className="skeleton skeleton-dot" />
                  <span className="skeleton skeleton-title" />
                  <span className="skeleton skeleton-price" />
                  <span className="skeleton skeleton-copy" />
                  <span className="skeleton skeleton-copy short" />
                  <span className="skeleton skeleton-button" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function CatalogHeader({ catalogName, language, onLanguageChange }: { catalogName: string; language: CatalogLanguage; onLanguageChange: (language: CatalogLanguage) => void }) {
  const copy = COPY[language];
  return (
    <header className="catalog-header">
      <div className="catalog-wrap catalog-header-inner">
        <a className="brand" href="#inicio" aria-label={language === 'pt' ? `Ir para o início de ${catalogName}` : `Ir al inicio de ${catalogName}`}>
          <span className="brand-mark">MS</span><span>{catalogName}</span>
        </a>
        <div className="header-actions">
          <div className="language-switch" role="group" aria-label={copy.languageLabel}>
            <button type="button" className={language === 'es' ? 'is-active' : ''} aria-pressed={language === 'es'} onClick={() => onLanguageChange('es')}>ES</button>
            <button type="button" className={language === 'pt' ? 'is-active' : ''} aria-pressed={language === 'pt'} onClick={() => onLanguageChange('pt')}>PT</button>
          </div>
          <a className="header-cta" href="#servicios">{copy.headerCta}</a>
        </div>
      </div>
    </header>
  );
}

function TrustBand({ language }: { language: CatalogLanguage }) {
  return (
    <section className="trust-band" aria-label={language === 'pt' ? 'Diferenciais do estúdio' : 'Diferenciales del estudio'}>
      <div className="catalog-wrap trust-grid">
        {COPY[language].trust.map(([title, text]) => <span key={title}><strong>{title}</strong> {text}</span>)}
      </div>
    </section>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="step"><span className="step-number">{number}</span><h3>{title}</h3><p>{text}</p></div>;
}

function PageShell({ children, template = 'default' }: { children: ReactNode; template?: CatalogTemplate }) {
  // Um valor novo do backend não pode deixar a árvore pública vazia.
  const safeTemplate: CatalogTemplate = template === 'gold_catalog' || template === 'beauty_concierge' ? template : 'default';
  return (
    <div className={`catalog-page catalog-template-${safeTemplate}`}>
      <style>{`
        /* Atelier Bilíngue: contraste sereno, tipografia editorial e estados de espera acolhedores. */
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; background: #f3eee4; color: #211d1a; font-family: Montserrat, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        a { color: inherit; }
        button { font: inherit; }
        .catalog-page { min-height: 100vh; overflow: hidden; background: #f3eee4; }
        .catalog-wrap { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
        .catalog-header { position: relative; z-index: 2; border-bottom: 1px solid rgba(78, 62, 49, .12); background: rgba(243, 238, 228, .88); backdrop-filter: blur(12px); }
        .catalog-header-inner { display: flex; align-items: center; justify-content: space-between; min-height: 78px; gap: 20px; }
        .brand { display: inline-flex; align-items: center; gap: 12px; color: #211d1a; font-family: 'Playfair Display', Georgia, "Times New Roman", serif; font-size: 20px; font-style: italic; text-decoration: none; }
        .brand-mark { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #bd8a6d; border-radius: 50%; color: #8d5c43; font-family: Montserrat, sans-serif; font-size: 11px; font-style: normal; letter-spacing: .08em; }
        .header-actions { display: flex; align-items: center; gap: 12px; }
        .language-switch { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid rgba(60, 48, 39, .25); border-radius: 999px; background: rgba(255, 253, 249, .66); }
        .language-switch button { min-width: 30px; padding: 6px 7px; border: 0; border-radius: 999px; background: transparent; color: #6d5b4e; cursor: pointer; font-size: 10px; font-weight: 800; letter-spacing: .08em; transition: color 160ms cubic-bezier(.23, 1, .32, 1), background 160ms cubic-bezier(.23, 1, .32, 1), transform 160ms cubic-bezier(.23, 1, .32, 1); }
        .language-switch button:hover, .language-switch button:focus-visible { color: #3c3027; background: rgba(201, 152, 122, .18); outline: none; }
        .language-switch button:focus-visible { box-shadow: 0 0 0 2px #f3eee4, 0 0 0 4px #8d5c43; }
        .language-switch button.is-active { background: #8d5c43; color: #fffdf9; }
        .language-switch button:active { transform: scale(.96); }
        .header-cta, .hero-link { color: #3c3027; font-size: 12px; letter-spacing: .06em; text-decoration: none; text-transform: uppercase; }
        .header-cta { padding: 12px 20px; border: 1px solid rgba(60, 48, 39, .45); border-radius: 999px; }
        .catalog-hero { position: relative; padding: 110px 0 120px; text-align: center; background: radial-gradient(circle at 50% 15%, rgba(255, 255, 255, .78), transparent 48%), linear-gradient(135deg, #f7f1e7 0%, #eadfce 100%); }
        .hero-inner { max-width: 820px; }
        .eyebrow { color: #987254; font-size: 11px; font-weight: 700; letter-spacing: .19em; text-transform: uppercase; }
        .catalog-hero h1 { max-width: 760px; margin: 22px auto 14px; color: #211d1a; font-family: 'Playfair Display', Georgia, "Times New Roman", serif; font-size: clamp(48px, 8vw, 94px); font-weight: 700; font-style: italic; line-height: .98; letter-spacing: -.03em; }
        .hero-stroke { width: 170px; height: 18px; margin: 0 auto 22px; border-top: 2px solid #c9987a; border-radius: 50%; transform: rotate(-2deg); }
        .hero-sub { max-width: 560px; margin: 0 auto 34px; color: #66574d; font-size: 16px; line-height: 1.75; }
        .hero-link { display: inline-flex; gap: 10px; align-items: center; border-bottom: 1px solid #c9987a; padding-bottom: 5px; }
        .trust-band { background: #c9987a; color: #fffdf9; }
        .trust-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; padding: 25px 0; font-size: 11px; line-height: 1.5; text-align: center; }
        .trust-grid strong { display: block; color: #fffdf9; font-size: 12px; letter-spacing: .04em; }
        .steps-section, .services-section, .faq-section { padding: 100px 0; }
        .steps-section h2, .services-section h2, .faq-section h2 { max-width: 680px; margin: 12px 0 46px; color: #211d1a; font-family: 'Playfair Display', Georgia, "Times New Roman", serif; font-size: clamp(34px, 5vw, 58px); font-weight: 700; font-style: italic; line-height: 1.05; letter-spacing: -.02em; }
        .steps-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .step { padding: 22px 0; border-top: 1px solid rgba(78, 62, 49, .3); }
        .step-number { color: #b88063; font-family: 'Playfair Display', Georgia, serif; font-size: 18px; }
        .step h3 { margin: 34px 0 10px; color: #211d1a; font-family: 'Playfair Display', Georgia, serif; font-size: 25px; font-weight: 400; }
        .step p, .product-card p, .faq-item p { color: #6f6258; font-size: 14px; line-height: 1.7; }
        .services-section { background: #f8f4ed; }
        .product-groups { display: grid; gap: 62px; }
        .group-title { margin: 0 0 18px; color: #987254; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }
        .product-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .product-card { display: flex; min-height: 270px; flex-direction: column; border: 1px solid rgba(78, 62, 49, .15); background: #fffdf9; box-shadow: 0 18px 50px rgba(78, 62, 49, .05); overflow: hidden; }
        .product-card-body { display: flex; flex: 1; flex-direction: column; padding: 25px; }
        .product-card.skeleton-card { padding: 25px; }
        .product-card-image { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; display: block; }
        .product-card.has-image .product-card-body { padding-top: 22px; }
        .product-topline { display: flex; align-items: center; justify-content: space-between; min-height: 18px; color: #987254; font-size: 11px; letter-spacing: .05em; }
        .product-dot { width: 7px; height: 7px; border: 1px solid #bc896c; border-radius: 50%; }
        .product-card h4 { margin: 32px 0 16px; color: #211d1a; font-family: 'Playfair Display', Georgia, serif; font-size: 26px; font-weight: 400; line-height: 1.05; }
        .price-row { display: flex; align-items: baseline; gap: 8px; }
        .price-row strong { color: #8d5c43; font-family: 'Playfair Display', Georgia, serif; font-size: 24px; font-weight: 400; }
        .price-row span { color: #987254; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
        .product-card p { flex: 1; margin: 16px 0 20px; }
        .variants { margin: 4px 0 18px; border-top: 1px solid rgba(78, 62, 49, .12); }
        .variant-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 11px 0; border-bottom: 1px solid rgba(78, 62, 49, .12); color: #6f6258; font-size: 12px; }
        .variant-name { color: #473b33; font-weight: 600; }
        .variant-image { float: left; width: 42px; height: 42px; margin: 1px 9px 4px 0; border: 1px solid rgba(78, 62, 49, .16); object-fit: cover; }
        .product-card .variant-description { margin: 4px 0 0; color: #7a6d63; font-size: 11px; line-height: 1.5; }
        .variant-whatsapp { display: inline-flex; margin-top: 8px; color: #8d5c43; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-decoration: underline; text-underline-offset: 3px; text-transform: uppercase; }
        .before-after-gallery { margin: 18px 0 4px; border-top: 1px solid rgba(78, 62, 49, .14); padding-top: 13px; }
        .before-after-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: #8d5c43; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
        .before-after-heading em { overflow: hidden; color: #a18d7d; font-size: 8px; font-style: normal; font-weight: 500; letter-spacing: .04em; text-overflow: ellipsis; white-space: nowrap; }
        .before-after-stage { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: #e8ded2; }
        .before-after-stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .before-after-overlay { pointer-events: none; }
        .before-after-line { position: absolute; top: 0; bottom: 0; width: 2px; background: #fffdf9; box-shadow: 0 0 0 1px rgba(33, 29, 26, .16); transform: translateX(-1px); pointer-events: none; }
        .before-after-line::after { position: absolute; top: 50%; left: 50%; width: 24px; height: 24px; border: 1px solid rgba(33, 29, 26, .2); border-radius: 50%; background: #fffdf9; box-shadow: 0 3px 8px rgba(33, 29, 26, .12); content: '↔'; color: #8d5c43; font-size: 12px; line-height: 22px; text-align: center; transform: translate(-50%, -50%); }
        .before-after-label { position: absolute; top: 9px; z-index: 1; padding: 4px 6px; background: rgba(33, 29, 26, .64); color: #fffdf9; font-size: 8px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; pointer-events: none; }
        .before-label { left: 9px; } .after-label { right: 9px; }
        .before-after-range { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
        .before-after-caption { margin: 8px 0 0 !important; color: #8a796c !important; font-size: 10px !important; line-height: 1.5 !important; }
        .before-after-pagination { display: flex; gap: 5px; margin-top: 9px; }
        .before-after-pagination button { width: 21px; height: 21px; border: 1px solid rgba(141, 92, 67, .3); background: transparent; color: #8d5c43; cursor: pointer; font-size: 9px; }
        .before-after-pagination button[aria-current="true"] { background: #8d5c43; color: #fffdf9; }
        .variant-row strong { color: #8d5c43; font-weight: 600; }
        .whatsapp-button { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #c9987a; color: #fffdf9; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-decoration: none; text-transform: uppercase; transition: transform 160ms cubic-bezier(.23, 1, .32, 1), background 160ms cubic-bezier(.23, 1, .32, 1); }
        .whatsapp-button:hover { background: #b88063; }
        .whatsapp-button:active { transform: scale(.98); }
        .faq-section { background: #eee4d8; }
        .faq-inner { display: grid; grid-template-columns: .8fr 1.2fr; gap: 80px; }
        .faq-inner h2 { margin-top: 12px; }
        .faq-list { border-top: 1px solid rgba(78, 62, 49, .25); }
        .faq-item { border-bottom: 1px solid rgba(78, 62, 49, .25); }
        .faq-item button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 0; border: 0; background: none; color: #30261f; cursor: pointer; font-family: 'Playfair Display', Georgia, serif; font-size: 20px; text-align: left; }
        .faq-item button:focus-visible { outline: 2px solid #8d5c43; outline-offset: 4px; }
        .faq-item p { margin: 0; padding: 0 0 20px; }
        .catalog-footer { padding: 55px 0 95px; background: #221e1a; color: #f5ebdd; }
        .footer-grid { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
        .catalog-footer p { margin: 7px 0; color: #d1c1b2; font-size: 13px; }
        .catalog-footer .footer-brand { color: #fff7ec; font-family: 'Playfair Display', Georgia, serif; font-size: 22px; }
        .footer-links { display: flex; flex-wrap: wrap; gap: 18px; }
        .footer-links a { color: #d4a181; font-size: 12px; text-decoration: none; text-transform: uppercase; }
        .sticky-whatsapp { position: fixed; right: 18px; bottom: 18px; z-index: 5; display: inline-flex; align-items: center; gap: 10px; padding: 15px 18px; border-radius: 999px; background: #c9987a; color: white; box-shadow: 0 14px 30px rgba(44, 32, 24, .2); font-size: 11px; font-weight: 700; text-decoration: none; text-transform: uppercase; transition: transform 160ms cubic-bezier(.23, 1, .32, 1); }
        .sticky-whatsapp:active { transform: scale(.97); }
        .catalog-state { display: grid; min-height: calc(100vh - 78px); place-content: center; width: min(620px, calc(100% - 40px)); margin: 0 auto; padding: 40px 0; text-align: center; }
        .catalog-state h1 { margin: 18px 0 12px; color: #211d1a; font-family: 'Playfair Display', Georgia, serif; font-size: 48px; font-weight: 400; }
        .catalog-state p { color: #6f6258; line-height: 1.7; }
        .loading-services { min-height: 540px; background: #f8f4ed; }
        .loading-services h2 { max-width: 740px; margin-bottom: 18px; }
        .loading-copy { max-width: 540px; margin: 0 0 22px; color: #6f6258; font-size: 15px; line-height: 1.7; }
        .loading-status { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 34px; color: #8d5c43; font-size: 11px; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }
        .loading-orb { width: 9px; height: 9px; border-radius: 50%; background: #c9987a; box-shadow: 0 0 0 5px rgba(201, 152, 122, .14); animation: loadingPulse 1.4s cubic-bezier(.23, 1, .32, 1) infinite; }
        .skeleton-card { gap: 18px; min-height: 290px; }
        .skeleton { display: block; background: linear-gradient(100deg, rgba(201,152,122,.10) 25%, rgba(255,253,249,.82) 45%, rgba(201,152,122,.12) 65%); background-size: 220% 100%; animation: skeletonShimmer 1.4s cubic-bezier(.23, 1, .32, 1) infinite; }
        .skeleton-dot { width: 7px; height: 7px; border-radius: 50%; }
        .skeleton-title { width: 68%; height: 28px; margin-top: 14px; }
        .skeleton-price { width: 45%; height: 19px; }
        .skeleton-copy { width: 100%; height: 12px; margin-top: 8px; }
        .skeleton-copy.short { width: 78%; }
        .skeleton-button { width: 100%; height: 40px; margin-top: auto; }
        @keyframes loadingPulse { 50% { transform: scale(.72); opacity: .55; } }
        @keyframes skeletonShimmer { to { background-position: -120% 0; } }
        @media (prefers-reduced-motion: reduce) { .loading-orb, .skeleton { animation: none; } }
        /* Templates tenant-scoped: overrides inline para vencer os estilos base do catálogo. */
        .catalog-template-beauty_concierge { background: #eef6ff; color: #102a43; }
        .catalog-template-beauty_concierge .catalog-header { background: rgba(238,246,255,.92); border-color: rgba(31,111,186,.22); }
        .catalog-template-beauty_concierge .brand, .catalog-template-beauty_concierge .header-cta { color: #102a43; }
        .catalog-template-beauty_concierge .brand-mark { border-color: #1f6fba; color: #1f6fba; }
        .catalog-template-beauty_concierge .catalog-hero { background: radial-gradient(circle at 72% 14%, rgba(255,127,105,.25), transparent 34%), linear-gradient(135deg,#eef6ff 0%,#d7eaff 100%); }
        .catalog-template-beauty_concierge .catalog-hero h1, .catalog-template-beauty_concierge .steps-section h2, .catalog-template-beauty_concierge .services-section h2, .catalog-template-beauty_concierge .faq-section h2 { color: #102a43; }
        .catalog-template-beauty_concierge .catalog-hero h1 em, .catalog-template-beauty_concierge .catalog-hero h1 i, .catalog-template-beauty_concierge .services-section h2 em { color: #1f6fba; }
        .catalog-template-beauty_concierge .eyebrow, .catalog-template-beauty_concierge .step-number, .catalog-template-beauty_concierge .product-dot { color: #1f6fba; }
        .catalog-template-beauty_concierge .trust-band, .catalog-template-beauty_concierge .whatsapp-button, .catalog-template-beauty_concierge .sticky-whatsapp { background: #1f6fba; }
        .catalog-template-beauty_concierge .services-section { background: #f8fbff; }
        .catalog-template-beauty_concierge .faq-section { background: #ffe9e3; }
        .catalog-template-gold_catalog { background: #090807; color: #f7efe2; }
        .catalog-template-gold_catalog .catalog-header { background: rgba(9,8,7,.94); border-color: rgba(232,185,94,.28); }
        .catalog-template-gold_catalog .brand, .catalog-template-gold_catalog .header-cta { color: #f7efe2; }
        .catalog-template-gold_catalog .brand-mark { border-color: #c99539; color: #e8b95e; }
        .catalog-template-gold_catalog .language-switch { border-color: rgba(232,185,94,.4); background: rgba(24,18,12,.85); }
        .catalog-template-gold_catalog .language-switch button { color: #cdbfae; }
        .catalog-template-gold_catalog .language-switch button.is-active { background: #c99539; color: #150f08; }
        .catalog-template-gold_catalog .catalog-hero { background: radial-gradient(circle at 74% 12%, rgba(178,112,28,.32), transparent 36%), #090807; }
        .catalog-template-gold_catalog .catalog-hero h1, .catalog-template-gold_catalog .steps-section h2, .catalog-template-gold_catalog .services-section h2, .catalog-template-gold_catalog .faq-section h2 { color: #f7efe2; }
        .catalog-template-gold_catalog .catalog-hero h1 em, .catalog-template-gold_catalog .catalog-hero h1 i, .catalog-template-gold_catalog .steps-section h2 em, .catalog-template-gold_catalog .services-section h2 em, .catalog-template-gold_catalog .faq-section h2 em { color: #e8b95e; }
        .catalog-template-gold_catalog .eyebrow, .catalog-template-gold_catalog .step-number, .catalog-template-gold_catalog .product-dot { color: #e8b95e; }
        .catalog-template-gold_catalog .hero-sub, .catalog-template-gold_catalog .step p, .catalog-template-gold_catalog .faq-item p { color: #cdbfae; }
        .catalog-template-gold_catalog .hero-link, .catalog-template-gold_catalog .price-row strong { color: #e8b95e; border-color: #c99539; }
        .catalog-template-gold_catalog .trust-band, .catalog-template-gold_catalog .whatsapp-button, .catalog-template-gold_catalog .sticky-whatsapp { background: #e8b95e; color: #150f08; }
        .catalog-template-gold_catalog .steps-section, .catalog-template-gold_catalog .faq-section { background: #15100c; }
        .catalog-template-gold_catalog .services-section { background: #f3eadc; color: #21170f; }
        .catalog-template-gold_catalog .services-section h2, .catalog-template-gold_catalog .services-section .group-title, .catalog-template-gold_catalog .services-section .product-card h4 { color: #21170f; }
        .catalog-template-gold_catalog .product-card { background: #fffaf1; border-color: rgba(133,91,31,.28); }
        .catalog-template-gold_catalog .catalog-footer { background: #090807; color: #cdbfae; }
        @media (max-width: 800px) {
          .catalog-wrap { width: min(100% - 28px, 620px); }
          .catalog-header-inner { min-height: 68px; }
          .brand { gap: 8px; font-size: 16px; }
          .brand-mark { width: 33px; height: 33px; }
          .header-actions { gap: 8px; }
          .header-cta { padding: 10px 12px; font-size: 10px; }
          .catalog-hero { padding: 76px 0 82px; }
          .trust-grid, .steps-grid, .product-grid, .faq-inner { grid-template-columns: 1fr; }
          .trust-grid { gap: 15px; text-align: left; }
          .trust-grid span { display: flex; gap: 8px; align-items: baseline; }
          .trust-grid strong { display: inline; }
          .steps-section, .services-section, .faq-section { padding: 72px 0; }
          .faq-inner { gap: 40px; }
          .footer-grid { flex-direction: column; }
          .sticky-whatsapp { right: 12px; bottom: 12px; left: 12px; justify-content: center; }
        }
        @media (max-width: 460px) {
          .brand > span:last-child { max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .header-cta { display: none; }
        }
      `}</style>
      {children}
    </div>
  );
}

export default PublicCatalogPage;
