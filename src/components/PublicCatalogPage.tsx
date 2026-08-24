import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

interface PublicCatalogVariant {
  code: string;
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

const FAQS = [
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
];

/**
 * `template` vem da aba Catálogo do painel (`whatsappMessageGeneral`/
 * `whatsappMessageProduct`) e permite ao operador controlar o texto
 * pré-preenchido sem depender de deploy de código; `{produto}` é trocado
 * pelo nome do produto quando presente. Ausente/vazio cai no texto padrão.
 */
function whatsappUrl(phone: string | undefined, productName: string | undefined, template: string | undefined): string | null {
  if (!phone) return null;
  const defaultMessage = productName
    ? `Hola, quiero información sobre ${productName}.`
    : 'Hola, quiero información sobre los servicios.';
  const message = template ? (productName ? template.split('{produto}').join(productName) : template) : defaultMessage;
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

function formatProductPrice(product: PublicCatalogProduct): string {
  if (!product.price) return 'Consultar';
  return product.price;
}

export function PublicCatalogPage({ slug }: PublicCatalogPageProps) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState(0);

  // O resto do app (painel) é escuro e declara `color-scheme: dark` no
  // index.css compartilhado — o CSS `:root { color-scheme: light }` deste
  // componente nem sempre é suficiente pra desligar o "Tema escuro
  // automático" do Chrome Android nessa página clara: achado real (23/08/2026,
  // print do dono do produto) — o tema forçado do Chrome lavava
  // especificamente os títulos grandes (h1/h2), deixando quase ilegíveis,
  // mesmo com a fonte/cor corretas no CSS. A tag <meta name="color-scheme">
  // é o sinal que a documentação do Chrome trata como definitivo pra opt-out
  // do tema forçado, então é adicionada via JS (antes do primeiro paint, com
  // useLayoutEffect) só enquanto esta página estiver montada.
  useLayoutEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!catalog) return undefined;
    const previousTitle = document.title;
    document.title = `${catalog.tenant.name} | Catálogo`;
    return () => {
      document.title = previousTitle;
    };
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/public/catalog/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Catálogo no encontrado.' : 'No se pudo cargar el catálogo.');
        return response.json() as Promise<{ catalog: PublicCatalog }>;
      })
      .then((payload) => {
        if (!cancelled) setCatalog(payload.catalog);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el catálogo.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const groupedProducts = useMemo(() => {
    const groups = new Map<string, PublicCatalogProduct[]>();
    for (const product of catalog?.products || []) {
      const category = product.category?.trim() || 'Servicios';
      const items = groups.get(category) || [];
      items.push(product);
      groups.set(category, items);
    }
    return [...groups.entries()];
  }, [catalog?.products]);

  if (loading) {
    return <PageShell><div className="catalog-state">Cargando servicios…</div></PageShell>;
  }

  if (error || !catalog) {
    return (
      <PageShell>
        <div className="catalog-state">
          <span className="eyebrow">Pestañas por Monique</span>
          <h1>{error || 'Catálogo no encontrado.'}</h1>
          <p>Este catálogo no está disponible en este momento. Volvé a intentar en unos minutos.</p>
        </div>
      </PageShell>
    );
  }

  const generalWhatsapp = whatsappUrl(catalog.contact.whatsappNumber, undefined, catalog.contact.whatsappMessageGeneral);

  return (
    <PageShell>
      <header className="catalog-header">
        <div className="catalog-wrap catalog-header-inner">
          <a className="brand" href="#inicio" aria-label={`Ir al inicio de ${catalog.tenant.name}`}>
            <span className="brand-mark">MS</span>
            <span>{catalog.tenant.name}</span>
          </a>
          <a className="header-cta" href="#servicios">Ver servicios</a>
        </div>
      </header>

      <main id="inicio">
        <section className="catalog-hero">
          <div className="catalog-wrap hero-inner">
            <span className="eyebrow">Estudio de micropigmentación · Luque, Paraguay</span>
            <h1>Un trazo que no se nota como retoque.</h1>
            <div className="hero-stroke" aria-hidden="true" />
            <p className="hero-sub">Técnica brasileña en labios y cejas. Resultado natural, ambiente privado, sin apuro.</p>
            <a className="hero-link" href="#servicios">Ver servicios y precios <span aria-hidden="true">↓</span></a>
          </div>
        </section>

        <section className="trust-band" aria-label="Diferenciales del estudio">
          <div className="catalog-wrap trust-grid">
            <span><strong>13 años</strong> de experiencia</span>
            <span><strong>Técnica brasileña</strong> en labios y cejas</span>
            <span><strong>Ambiente privado</strong> y sensorial</span>
            <span><strong>Anestésico tópico</strong> cuando corresponde</span>
          </div>
        </section>

        <section className="steps-section">
          <div className="catalog-wrap">
            <span className="eyebrow">Cómo funciona</span>
            <h2>De la duda al resultado, en tres pasos.</h2>
            <div className="steps-grid">
              <Step number="01" title="Escribís" text="Nos contás qué buscás, sin compromiso ni apuro." />
              <Step number="02" title="Diseñamos juntas" text="Definimos el resultado antes de empezar, a tu gusto." />
              <Step number="03" title="Te vas lista" text="Con el resultado terminado, el mismo día." />
            </div>
          </div>
        </section>

        <section className="services-section" id="servicios">
          <div className="catalog-wrap">
            <span className="eyebrow">Servicios</span>
            <h2>Elegí el servicio que mejor acompaña tu rutina.</h2>
            <div className="product-groups">
              {groupedProducts.map(([category, products]) => (
                <section className="product-group" key={category}>
                  <h3 className="group-title">{category}</h3>
                  <div className="product-grid">
                    {products.map((product) => {
                      const productWhatsapp = whatsappUrl(catalog.contact.whatsappNumber, product.name, catalog.contact.whatsappMessageProduct);
                      return (
                        <article className="product-card" key={`${category}-${product.name}`}>
                          <div className="product-topline">
                            <span className="product-dot" aria-hidden="true" />
                            {formatDuration(product.durationMinutes) && <span>{formatDuration(product.durationMinutes)}</span>}
                          </div>
                          <h4>{product.name}</h4>
                          <div className="price-row">
                            <strong>{formatProductPrice(product)}</strong>
                            <span>Desde</span>
                          </div>
                          {product.description && <p>{product.description}</p>}
                          {product.variants && product.variants.length > 0 && (
                            <div className="variants" aria-label={`Variantes de ${product.name}`}>
                              {product.variants.map((variant) => (
                                <div className="variant-row" key={variant.code}>
                                  <span>{variant.code}</span>
                                  <strong>{variant.price}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                          {productWhatsapp && <a className="whatsapp-button" href={productWhatsapp} target="_blank" rel="noreferrer">Consultar por WhatsApp <span aria-hidden="true">↗</span></a>}
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
            <span className="eyebrow">Antes de escribir</span>
            <h2>Las preguntas que todas hacen</h2>
            <div className="faq-list">
              {FAQS.map((faq, index) => {
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
            {catalog.contact.locationMapsUrl && <a href={catalog.contact.locationMapsUrl} target="_blank" rel="noreferrer">Cómo llegar</a>}
          </div>
        </div>
      </footer>

      {generalWhatsapp && <a className="sticky-whatsapp" href={generalWhatsapp} target="_blank" rel="noreferrer">Escribinos por WhatsApp <span aria-hidden="true">↗</span></a>}
    </PageShell>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="step">
      <span className="step-number">{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="catalog-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; background: #f3eee4; color: #211d1a; font-family: Montserrat, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        a { color: inherit; }
        .catalog-page { min-height: 100vh; overflow: hidden; background: #f3eee4; }
        .catalog-wrap { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
        .catalog-header { position: relative; z-index: 2; border-bottom: 1px solid rgba(78, 62, 49, .12); background: rgba(243, 238, 228, .88); backdrop-filter: blur(12px); }
        .catalog-header-inner { display: flex; align-items: center; justify-content: space-between; min-height: 78px; gap: 20px; }
        .brand { display: inline-flex; align-items: center; gap: 12px; color: #211d1a; font-family: 'Playfair Display', Georgia, "Times New Roman", serif; font-size: 20px; font-style: italic; text-decoration: none; }
        .brand-mark { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #bd8a6d; border-radius: 50%; color: #8d5c43; font-family: Montserrat, sans-serif; font-size: 11px; font-style: normal; letter-spacing: .08em; }
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
        .product-card { display: flex; min-height: 270px; flex-direction: column; padding: 25px; border: 1px solid rgba(78, 62, 49, .15); background: #fffdf9; box-shadow: 0 18px 50px rgba(78, 62, 49, .05); }
        .product-topline { display: flex; align-items: center; justify-content: space-between; min-height: 18px; color: #987254; font-size: 11px; letter-spacing: .05em; }
        .product-dot { width: 7px; height: 7px; border: 1px solid #bc896c; border-radius: 50%; }
        .product-card h4 { margin: 32px 0 16px; color: #211d1a; font-family: 'Playfair Display', Georgia, serif; font-size: 26px; font-weight: 400; line-height: 1.05; }
        .price-row { display: flex; align-items: baseline; gap: 8px; }
        .price-row strong { color: #8d5c43; font-family: 'Playfair Display', Georgia, serif; font-size: 24px; font-weight: 400; }
        .price-row span { color: #987254; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
        .product-card p { flex: 1; margin: 16px 0 20px; }
        .variants { margin: 4px 0 18px; border-top: 1px solid rgba(78, 62, 49, .12); }
        .variant-row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(78, 62, 49, .12); color: #6f6258; font-size: 12px; }
        .variant-row strong { color: #8d5c43; font-weight: 600; }
        .whatsapp-button { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #c9987a; color: #fffdf9; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-decoration: none; text-transform: uppercase; }
        .faq-section { background: #eee4d8; }
        .faq-inner { display: grid; grid-template-columns: .8fr 1.2fr; gap: 80px; }
        .faq-inner h2 { margin-top: 12px; }
        .faq-list { border-top: 1px solid rgba(78, 62, 49, .25); }
        .faq-item { border-bottom: 1px solid rgba(78, 62, 49, .25); }
        .faq-item button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 0; border: 0; background: none; color: #30261f; cursor: pointer; font-family: 'Playfair Display', Georgia, serif; font-size: 20px; text-align: left; }
        .faq-item p { margin: 0; padding: 0 0 20px; }
        .catalog-footer { padding: 55px 0 95px; background: #221e1a; color: #f5ebdd; }
        .footer-grid { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
        .catalog-footer p { margin: 7px 0; color: #d1c1b2; font-size: 13px; }
        .catalog-footer .footer-brand { color: #fff7ec; font-family: 'Playfair Display', Georgia, serif; font-size: 22px; }
        .footer-links { display: flex; flex-wrap: wrap; gap: 18px; }
        .footer-links a { color: #d4a181; font-size: 12px; text-decoration: none; text-transform: uppercase; }
        .sticky-whatsapp { position: fixed; right: 18px; bottom: 18px; z-index: 5; display: inline-flex; align-items: center; gap: 10px; padding: 15px 18px; border-radius: 999px; background: #c9987a; color: white; box-shadow: 0 14px 30px rgba(44, 32, 24, .2); font-size: 11px; font-weight: 700; text-decoration: none; text-transform: uppercase; }
        .catalog-state { display: grid; min-height: 100vh; place-content: center; width: min(620px, calc(100% - 40px)); margin: 0 auto; padding: 40px 0; text-align: center; }
        .catalog-state h1 { margin: 18px 0 12px; color: #211d1a; font-family: 'Playfair Display', Georgia, serif; font-size: 48px; font-weight: 400; }
        .catalog-state p { color: #6f6258; line-height: 1.7; }
        @media (max-width: 800px) {
          .catalog-wrap { width: min(100% - 28px, 620px); }
          .catalog-header-inner { min-height: 68px; }
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
      `}</style>
      {children}
    </div>
  );
}

export default PublicCatalogPage;
