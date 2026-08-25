/**
 * Direção visual: Operação Serena — cada variação deve ter contexto próprio,
 * com leitura leve e sem duplicar a explicação geral da família de serviços.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

// Design direction: Atelier Bilíngue — editorial, sereno e acolhedor; conteúdo essencial
// aparece antes dos dados dinâmicos e a escolha ES/PT é imediata, discreta e acessível.

interface PublicCatalogVariant {
  code: string;
  description?: string;
  dimensions?: string;
  litros?: number;
  price: string;
  priceAmount?: number;
  durationMinutes?: number;
}

interface PublicCatalogProduct {
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
}

interface PublicCatalog {
  tenant: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
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
}

interface PublicCatalogPageProps {
  slug: string;
}

type CatalogLanguage = 'es' | 'pt';

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

function whatsappUrl(phone: string | undefined, productName: string | undefined, template: string | undefined, language: CatalogLanguage): string | null {
  if (!phone) return null;
  const copy = COPY[language];
  const defaultMessage = productName ? copy.whatsappWithProduct(productName) : copy.whatsappGeneral;
  const message = language === 'es' && template
    ? (productName ? template.split('{produto}').join(productName) : template)
    : defaultMessage;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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

  const generalWhatsapp = whatsappUrl(catalog.contact.whatsappNumber, undefined, catalog.contact.whatsappMessageGeneral, language);
  const faqs = FAQS[language];

  return (
    <PageShell>
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
                      const productWhatsapp = whatsappUrl(catalog.contact.whatsappNumber, localizedName, catalog.contact.whatsappMessageProduct, language);
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
                            {product.variants && product.variants.length > 0 && (
                              <div className="variants" aria-label={`${copy.variantsOf} ${localizedName}`}>
                                {product.variants.map((variant) => (
                                  <div className="variant-row" key={variant.code}>
                                    <div>
                                      <span className="variant-name">{localizeCatalogText(variant.code, language)}</span>
                                      {variant.description && <p className="variant-description">{localizeCatalogText(variant.description, language)}</p>}
                                    </div>
                                    <strong>{localizeCatalogText(variant.price, language)}</strong>
                                  </div>
                                ))}
                              </div>
                            )}
                            {productWhatsapp && <a className="whatsapp-button" href={productWhatsapp} target="_blank" rel="noreferrer">{copy.whatsappProduct} <span aria-hidden="true">↗</span></a>}
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
            {generalWhatsapp && <a href={generalWhatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
            {catalog.contact.instagramUrl && <a href={catalog.contact.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
            {catalog.contact.locationMapsUrl && <a href={catalog.contact.locationMapsUrl} target="_blank" rel="noreferrer">{copy.footerMap}</a>}
          </div>
        </div>
      </footer>

      {generalWhatsapp && <a className="sticky-whatsapp" href={generalWhatsapp} target="_blank" rel="noreferrer">{copy.stickyWhatsapp} <span aria-hidden="true">↗</span></a>}
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

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="catalog-page">
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
        .product-card .variant-description { margin: 4px 0 0; color: #7a6d63; font-size: 11px; line-height: 1.5; }
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
