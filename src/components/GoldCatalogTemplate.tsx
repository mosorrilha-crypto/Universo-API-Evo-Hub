/*
 * Direção visual: Gold Gamificado Monique — catálogo de desejo com missão curta,
 * escolha por objetivo e leitura editorial assimétrica. Este arquivo é exclusivo
 * do template `gold_catalog`; Default e Beauty Concierge continuam no componente
 * público original.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, Clock3, MapPin, MessageCircle, Sparkles } from 'lucide-react';
import type { CatalogLanguage, PublicCatalog, PublicCatalogProduct } from './PublicCatalogPage';

interface GoldCatalogTemplateProps {
  catalog: PublicCatalog;
  slug: string;
  language: CatalogLanguage;
  onLanguageChange: (language: CatalogLanguage) => void;
}

const COPY = {
  es: {
    eyebrow: 'Estudio de micropigmentación · Luque, Paraguay',
    heroTitle: 'Un trazo que no se nota como retoque.',
    heroCopy: 'Técnica brasileña en labios y cejas. Resultados naturales, un ambiente privado y una atención pensada para vos.',
    seeServices: 'Ver servicios',
    instagram: 'Ver Instagram',
    studio: '01 · El estudio',
    studioTitle: 'Tu rostro, tu ritmo, tu resultado.',
    studioCopy: 'No se trata de cambiarte. Se trata de diseñar juntas un resultado que se sienta tuyo: armónico, ligero y pensado para tu rutina.',
    method: 'Nuestra forma de trabajar',
    methodTitle: 'Precisión sin prisa.',
    methodCopy: 'Ambiente privado y sensorial. Anestésico tópico cuando corresponde.',
    quest: 'Quest 01 · Descubrí tu estilo',
    questDone: 'completada',
    mission: 'Tu misión de belleza',
    missionTitle: 'Elegí cómo querés sentirte.',
    missionCopy: 'No necesitás conocer el nombre de la técnica. Elegí tu objetivo y encontrá tu próximo paso.',
    choose: 'Elegí un objetivo para avanzar',
    chosen: 'Objetivo elegido',
    portfolio: 'Portfólio real',
    portfolioTitle: 'Resultados que podés ver de cerca.',
    services: '03 · Servicios',
    servicesTitle: 'Catálogo claro. Elegí con confianza.',
    all: 'Todos',
    consult: 'Consultar',
    from: 'Desde',
    process: '04 · El proceso',
    processTitle: 'De la duda al resultado, en tres pasos.',
    contact: 'Hablemos de lo que querés mejorar.',
    contactCopy: 'Contame qué estás buscando y te orientamos con calma. Este primer contacto no confirma una reserva.',
    whatsapp: 'Enviar a WhatsApp',
    noImage: 'Resultado real del estudio',
    currencyFallback: 'Consultar',
  },
  pt: {
    eyebrow: 'Estúdio de micropigmentação · Luque, Paraguai',
    heroTitle: 'Um traço que não parece retoque.',
    heroCopy: 'Técnica brasileira em lábios e sobrancelhas. Resultados naturais, ambiente privativo e atendimento pensado para você.',
    seeServices: 'Ver serviços',
    instagram: 'Ver Instagram',
    studio: '01 · O estúdio',
    studioTitle: 'Seu rosto, seu ritmo, seu resultado.',
    studioCopy: 'Não se trata de mudar você. É criar juntas um resultado que pareça seu: harmônico, leve e pensado para sua rotina.',
    method: 'Nossa forma de trabalhar',
    methodTitle: 'Precisão sem pressa.',
    methodCopy: 'Ambiente privativo e sensorial. Anestésico tópico quando necessário.',
    quest: 'Quest 01 · Descubra seu estilo',
    questDone: 'concluída',
    mission: 'Sua missão de beleza',
    missionTitle: 'Escolha como você quer se sentir.',
    missionCopy: 'Você não precisa conhecer o nome da técnica. Escolha seu objetivo e encontre o próximo passo.',
    choose: 'Escolha um objetivo para avançar',
    chosen: 'Objetivo escolhido',
    portfolio: 'Portfólio real',
    portfolioTitle: 'Resultados para ver de perto.',
    services: '03 · Serviços',
    servicesTitle: 'Catálogo claro. Escolha com confiança.',
    all: 'Todos',
    consult: 'Consultar',
    from: 'A partir de',
    process: '04 · O processo',
    processTitle: 'Da dúvida ao resultado, em três passos.',
    contact: 'Vamos falar sobre o que você quer melhorar.',
    contactCopy: 'Conte o que você procura e orientamos com calma. Este primeiro contato não confirma uma reserva.',
    whatsapp: 'Enviar para WhatsApp',
    noImage: 'Resultado real do estúdio',
    currencyFallback: 'Consultar',
  },
} as const;

const QUESTS = [
  { es: 'Quiero practicidad', pt: 'Quero praticidade', match: ['Lash Lift', 'Diseño Tradicional con Hilo'] },
  { es: 'Quiero más definición', pt: 'Quero mais definição', match: ['Efecto Rímel', 'Browlamination'] },
  { es: 'Tengo zonas para equilibrar', pt: 'Quero equilibrar algumas áreas', match: ['Microshading', 'Microblading', 'Microlips'] },
  { es: 'Quiero un look completo', pt: 'Quero um visual completo', match: ['Combo Full Face', 'Combo'] },
];

function productText(product: PublicCatalogProduct, language: CatalogLanguage): string {
  if (language === 'es') return product.name;
  const map: Record<string, string> = {
    Pestañas: 'Cílios',
    Cejas: 'Sobrancelhas',
    Labios: 'Lábios',
    'Combo Full Face': 'Combo Full Face',
  };
  return map[product.name] || product.name;
}

function contactHref(slug: string, catalog: PublicCatalog, language: CatalogLanguage, product?: string): string {
  const fallback = language === 'pt' ? 'Olá, quero informações sobre os serviços.' : 'Hola, quiero información sobre los servicios.';
  const message = product
    ? (language === 'pt' ? `Olá, quero informações sobre ${product}.` : `Hola, quiero información sobre ${product}.`)
    : (catalog.contact.whatsappMessageGeneral || fallback);
  const params = new URLSearchParams({ msg: message });
  if (product) params.set('product', product);
  return `/api/public/catalog/${encodeURIComponent(slug)}/whatsapp-click?${params.toString()}`;
}

function money(product: PublicCatalogProduct, language: CatalogLanguage): string {
  return product.price || (language === 'pt' ? 'Consultar' : 'Consultar');
}

export function GoldCatalogTemplate({ catalog, slug, language, onLanguageChange }: GoldCatalogTemplateProps) {
  const copy = COPY[language];
  const [activeCategory, setActiveCategory] = useState(copy.all);
  const [activeChoice, setActiveChoice] = useState<string | null>(null);
  const categories = useMemo(() => [copy.all, ...new Set(catalog.products.map((product) => product.category).filter(Boolean) as string[])], [catalog.products, copy.all]);
  const visibleProducts = useMemo(() => activeCategory === copy.all ? catalog.products : catalog.products.filter((product) => product.category === activeCategory), [activeCategory, catalog.products, copy.all]);
  const featuredImages = catalog.products.filter((product) => product.imageUrl).slice(0, 4);
  const heroImage = featuredImages[0]?.imageUrl;
  const instagram = catalog.contact.instagramUrl || 'https://instagram.com/pestanaspormonique';
  const maps = catalog.contact.locationMapsUrl;

  return (
    <main className="gold-gamified-page">
      <style>{`
        .gold-gamified-page{min-height:100vh;background:#f3ede3;color:#29231e;font-family:Montserrat,ui-sans-serif,system-ui,sans-serif}
        .gold-gamified-page *{box-sizing:border-box}.gold-gamified-page a{color:inherit}.gold-gamified-page h1,.gold-gamified-page h2,.gold-gamified-page h3{font-family:'Playfair Display',Georgia,serif;font-weight:400}.gold-gamified-wrap{width:min(1120px,calc(100% - 40px));margin:0 auto}.gold-gamified-header{position:absolute;inset:0 0 auto;z-index:5}.gold-gamified-header-inner{display:flex;align-items:center;justify-content:space-between;padding:20px 0}.gold-brand{display:flex;align-items:center;gap:12px;text-decoration:none}.gold-brand-mark{display:grid;place-items:center;width:40px;height:40px;border:1px solid #c99173;border-radius:50%;font-family:'Playfair Display',Georgia,serif;font-style:italic}.gold-brand-name{font-family:'Playfair Display',Georgia,serif;font-size:21px;font-style:italic}.gold-brand-sub{display:block;margin-top:3px;color:#705d50;font-size:9px;letter-spacing:.16em;text-transform:uppercase}.gold-nav{display:flex;align-items:center;gap:26px;color:#594a40;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.gold-nav a{text-decoration:none}.gold-language{display:flex;gap:4px;margin-left:22px;padding:3px;border:1px solid #cdbbad;background:#f7f1e8;font-size:10px;font-weight:700}.gold-language button{border:0;background:transparent;padding:6px 8px;cursor:pointer}.gold-language button.active{background:#29231e;color:#fffaf1}.gold-hero{padding-top:116px;background:#f3ede3}.gold-hero-grid{display:grid;grid-template-columns:.9fr 1.1fr;align-items:center;gap:70px;min-height:610px;padding-bottom:72px}.gold-eyebrow{color:#9c6c57;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.gold-hero h1{max-width:620px;margin:25px 0 0;font-size:clamp(56px,8vw,94px);line-height:.88;letter-spacing:-.045em}.gold-hero h1 em,.gold-section-title em{color:#a76f58}.gold-hero-copy{max-width:430px;margin:28px 0 0;color:#6a594c;font-size:15px;line-height:1.85}.gold-actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:34px}.gold-cta{display:inline-flex;align-items:center;gap:10px;padding:15px 20px;background:#c99173;color:#fffaf1!important;font-size:10px;font-weight:700;letter-spacing:.15em;text-decoration:none;text-transform:uppercase}.gold-text-link{display:inline-flex;align-items:center;gap:8px;color:#6d5748!important;font-size:10px;font-weight:700;letter-spacing:.14em;text-decoration:none;text-transform:uppercase}.gold-hero-art{position:relative;max-width:560px;margin-left:auto}.gold-hero-art img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;box-shadow:18px 22px 0 #e6d8c8}.gold-hero-placeholder{display:grid;place-items:center;aspect-ratio:3/4;background:#d4ac94;color:#fffaf1;font-family:'Playfair Display',Georgia,serif;font-size:28px;font-style:italic}.gold-hero-stamp{position:absolute;right:-28px;bottom:-32px;color:#c99173;font-family:'Playfair Display',Georgia,serif;font-size:72px;font-style:italic}.gold-proof{border-block:1px solid #d2c1b0;background:#c99173;color:#fffaf1}.gold-proof-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:25px 0;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.gold-proof-item{display:flex;align-items:center;gap:12px}.gold-proof-item strong{font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:400}.gold-section{padding:94px 0;background:#f8f3eb}.gold-two-col{display:grid;grid-template-columns:.75fr 1.25fr;gap:84px}.gold-section-title{margin:18px 0 0;font-size:clamp(44px,5vw,64px);line-height:.95;letter-spacing:-.03em}.gold-studio-copy{display:grid;grid-template-columns:1fr .8fr;align-items:end;gap:40px}.gold-studio-copy p,.gold-method p{color:#655548;font-size:16px;line-height:2}.gold-method{border-left:1px solid #d7c8b9;padding-left:24px}.gold-method .gold-eyebrow{margin-bottom:12px}.gold-method h3{margin:0;font-size:30px;line-height:1}.gold-method p{margin:16px 0 0;font-size:13px;line-height:1.7}.gold-quest{padding:20px 0 96px;background:#f8f3eb}.gold-quest-card{padding:30px;background:#e7d4c5}.gold-quest-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:25px;color:#9e6750;font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase}.gold-quest-head span:last-child{border:1px solid #c9a995;border-radius:999px;padding:7px 10px;color:#8e6d5c}.gold-quest-grid{display:grid;grid-template-columns:.8fr 1.2fr;align-items:end;gap:32px}.gold-quest-title{max-width:420px;margin:16px 0 0;font-size:clamp(40px,5vw,56px);line-height:.96;letter-spacing:-.03em}.gold-quest-copy{max-width:390px;margin:16px 0 0;color:#6b574b;font-size:14px;line-height:1.7}.gold-progress{display:flex;align-items:center;gap:8px;margin-top:24px;color:#9e6750;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.gold-progress-dot{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#9e6750;color:#fffaf1}.gold-choice-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.gold-choice{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #d2b9a7;background:#f8f1e8b8;padding:16px;text-align:left;cursor:pointer;transition:transform .2s,background .2s,box-shadow .2s}.gold-choice:hover,.gold-choice.active{transform:translateY(-3px);background:#f8f1e8;box-shadow:0 0 0 2px #a76f58}.gold-choice strong{display:block;color:#49372e;font-size:13px}.gold-choice small{display:block;margin-top:5px;color:#776457;font-size:11px;line-height:1.45}.gold-choice-label{display:block;margin-top:14px;color:#aa9588;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.gold-choice.active .gold-choice-label{color:#9e6750}.gold-portfolio{padding:0 0 95px;background:#f8f3eb}.gold-heading-row{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:30px}.gold-heading-row .gold-section-title{max-width:600px}.gold-gallery{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:repeat(2,220px);gap:12px}.gold-gallery figure{position:relative;overflow:hidden;margin:0;background:#dfc0ae}.gold-gallery figure:first-child{grid-row:span 2}.gold-gallery img{width:100%;height:100%;object-fit:cover;transition:transform .4s}.gold-gallery figure:hover img{transform:scale(1.03)}.gold-gallery figcaption{position:absolute;right:10px;bottom:10px;left:10px;padding:7px;background:#29231ed9;color:#fffaf1;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.gold-gallery-empty{display:grid;place-items:center;min-height:260px;background:#e7d4c5;color:#816f62;font-family:'Playfair Display',Georgia,serif;font-size:25px;font-style:italic}.gold-services{padding:88px 0;background:#ebe0d4}.gold-filter{display:flex;flex-wrap:wrap;gap:8px;margin:28px 0}.gold-filter button{border:1px solid #cdbbad;background:transparent;padding:9px 12px;color:#6f5849;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.gold-filter button.active{background:#29231e;color:#fffaf1}.gold-service-list{border-top:1px solid #cbb8a8}.gold-service{display:grid;grid-template-columns:60px 1fr auto;align-items:center;gap:20px;border-bottom:1px solid #cbb8a8;padding:22px 0}.gold-service-index{font-family:'Playfair Display',Georgia,serif;font-size:24px;font-style:italic;color:#a76f58}.gold-service small{color:#9c6c57;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.gold-service h3{margin:7px 0 0;font-size:27px;line-height:1.05}.gold-service p{max-width:550px;margin:8px 0 0;color:#766356;font-size:12px;line-height:1.55}.gold-service-meta{display:flex;align-items:center;gap:17px;color:#735c4d;font-size:11px;white-space:nowrap}.gold-service-meta span{display:inline-flex;align-items:center;gap:5px}.gold-service-meta strong{color:#8d5c43;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:400}.gold-service-meta a{display:inline-flex;align-items:center;gap:5px;color:#8d5c43!important;font-size:9px;font-weight:700;letter-spacing:.1em;text-decoration:underline;text-transform:uppercase}.gold-process{padding:90px 0;background:#29231e;color:#fffaf1}.gold-process h2{color:#fffaf1}.gold-process h2 em{color:#d9a187}.gold-process-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:48px}.gold-step{border-top:1px solid #ffffff33;padding:24px 22px}.gold-step:first-child{border-left:0}.gold-step:not(:first-child){border-left:1px solid #ffffff33}.gold-step b{color:#d9a187;font-family:'Playfair Display',Georgia,serif;font-size:25px;font-style:italic;font-weight:400}.gold-step h3{margin:24px 0 0;font-size:28px}.gold-step p{margin:10px 0 0;color:#ffffff99;font-size:13px;line-height:1.7}.gold-contact{padding:95px 0;background:#f8f3eb}.gold-contact-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:80px}.gold-contact h2{max-width:540px}.gold-contact p{max-width:440px;color:#6c5a4d;font-size:15px;line-height:1.85}.gold-contact-info{display:grid;gap:16px;margin-top:28px;color:#665548;font-size:13px}.gold-contact-info a{display:flex;align-items:flex-start;gap:10px;text-decoration:none}.gold-contact-form{border-top:1px solid #cdbbad;padding-top:30px}.gold-contact-form h3{margin:0 0 24px;font-size:28px}.gold-contact-form a{display:inline-flex;align-items:center;gap:10px}.gold-footer{padding:30px 0;background:#29231e;color:#fffaf1}.gold-footer-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:10px;letter-spacing:.12em;text-transform:uppercase}.gold-footer a{text-decoration:none}@media(max-width:800px){.gold-gamified-wrap{width:min(100% - 28px,620px)}.gold-nav{display:none}.gold-language{margin-left:auto}.gold-hero-grid,.gold-two-col,.gold-quest-grid,.gold-contact-grid{grid-template-columns:1fr;gap:40px}.gold-hero-grid{min-height:0;padding:120px 0 65px}.gold-hero-art{width:calc(100% - 18px);margin:0 18px 0 0}.gold-proof-grid,.gold-process-grid{grid-template-columns:1fr;gap:0}.gold-proof-item{padding:8px 0}.gold-studio-copy{grid-template-columns:1fr}.gold-heading-row{display:block}.gold-heading-row .gold-text-link{margin-top:18px}.gold-gallery{grid-template-columns:1fr 1fr;grid-template-rows:220px 150px}.gold-gallery figure:first-child{grid-column:span 2;grid-row:auto}.gold-service{grid-template-columns:34px 1fr;gap:12px}.gold-service-meta{grid-column:2;flex-wrap:wrap;white-space:normal;gap:12px}.gold-service h3{font-size:23px}.gold-choice-grid{grid-template-columns:1fr}.gold-footer-inner{align-items:flex-start;flex-direction:column}}
      `}</style>
      <header className="gold-gamified-header"><div className="gold-gamified-wrap gold-gamified-header-inner"><a className="gold-brand" href="#inicio" aria-label={`${catalog.tenant.name}, inicio`}><span className="gold-brand-mark">MS</span><span><span className="gold-brand-name">Monique</span><span className="gold-brand-sub">Beauty Studio · Gold Quest</span></span></a><nav className="gold-nav"><a href="#servicios">{copy.services}</a><a href="#estudio">{copy.studio}</a><a href="#contacto">{copy.contact}</a></nav><div className="gold-language"><button type="button" className={language === 'es' ? 'active' : ''} onClick={() => onLanguageChange('es')}>ES</button><button type="button" className={language === 'pt' ? 'active' : ''} onClick={() => onLanguageChange('pt')}>PT</button></div></div></header>
      <section id="inicio" className="gold-hero"><div className="gold-gamified-wrap gold-hero-grid"><div><p className="gold-eyebrow">{copy.eyebrow}</p><h1>{copy.heroTitle}</h1><p className="gold-hero-copy">{copy.heroCopy}</p><div className="gold-actions"><a className="gold-cta" href="#servicios">{copy.seeServices} <ArrowUpRight size={15} /></a><a className="gold-text-link" href={instagram} target="_blank" rel="noreferrer"><Sparkles size={15} /> {copy.instagram}</a></div></div><div className="gold-hero-art">{heroImage ? <img src={heroImage} alt="Resultado real de cejas y pestañas" /> : <div className="gold-hero-placeholder">Monique Sorrilha</div>}<span className="gold-hero-stamp">MS</span></div></div><div className="gold-proof"><div className="gold-gamified-wrap gold-proof-grid"><div className="gold-proof-item"><strong>13</strong> {language === 'es' ? 'años de experiencia' : 'anos de experiência'}</div><div className="gold-proof-item"><Sparkles size={16} /> {language === 'es' ? 'Técnica brasileña' : 'Técnica brasileira'}</div><div className="gold-proof-item"><strong>01</strong> {language === 'es' ? 'atención personalizada' : 'atendimento personalizado'}</div></div></div></section>
      <section id="estudio" className="gold-section"><div className="gold-gamified-wrap gold-two-col"><div><p className="gold-eyebrow">{copy.studio}</p><h2 className="gold-section-title">{copy.studioTitle}</h2></div><div className="gold-studio-copy"><p>{copy.studioCopy}</p><div className="gold-method"><p className="gold-eyebrow">{copy.method}</p><h3>{copy.methodTitle}</h3><p>{copy.methodCopy}</p></div></div></div></section>
      <section className="gold-quest"><div className="gold-gamified-wrap"><div className="gold-quest-card"><div className="gold-quest-head"><span><span className="gold-progress-dot" style={{ display: 'inline-grid', width: 10, height: 10, marginRight: 8 }} />{copy.quest}</span><span>{activeChoice ? `1/1 ${copy.questDone}` : '0/1'}</span></div><div className="gold-quest-grid"><div><p className="gold-eyebrow">{copy.mission}</p><h2 className="gold-quest-title">{copy.missionTitle}</h2><p className="gold-quest-copy">{copy.missionCopy}</p><div className="gold-progress"><span className="gold-progress-dot">{activeChoice ? <Check size={14} /> : '1'}</span><span>{activeChoice ? `${copy.chosen}: ${activeChoice}` : copy.choose}</span></div></div><div className="gold-choice-grid">{QUESTS.map((quest) => { const title = language === 'es' ? quest.es : quest.pt; const active = activeChoice === title; return <button type="button" key={title} className={`gold-choice${active ? ' active' : ''}`} onClick={() => { setActiveChoice(title); document.getElementById('servicios')?.scrollIntoView({ behavior: 'smooth' }); }}><span><strong>{title}</strong><small>{quest.match.join(' · ')}</small><span className="gold-choice-label">{active ? copy.chosen : copy.seeServices}</span></span><ArrowUpRight size={16} /></button>; })}</div></div></div></div></section>
      <section className="gold-portfolio"><div className="gold-gamified-wrap"><div className="gold-heading-row"><div><p className="gold-eyebrow">{copy.portfolio}</p><h2 className="gold-section-title">{copy.portfolioTitle}</h2></div><a className="gold-text-link" href={instagram} target="_blank" rel="noreferrer">{copy.instagram} <ArrowUpRight size={14} /></a></div>{featuredImages.length ? <div className="gold-gallery">{featuredImages.map((product, index) => <figure key={`${product.name}-${index}`}><img src={product.imageUrl} alt={productText(product, language)} /><figcaption>{productText(product, language)}</figcaption></figure>)}</div> : <div className="gold-gallery-empty">{copy.noImage}</div>}</div></section>
      <section id="servicios" className="gold-services"><div className="gold-gamified-wrap"><p className="gold-eyebrow">{copy.services}</p><div className="gold-heading-row"><h2 className="gold-section-title">{copy.servicesTitle}</h2><span className="gold-eyebrow">{visibleProducts.length} opciones · atención personalizada</span></div><div className="gold-filter">{categories.map((category) => <button type="button" key={category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><div className="gold-service-list">{visibleProducts.map((product, index) => <article className="gold-service" key={`${product.name}-${index}`}><span className="gold-service-index">{String(index + 1).padStart(2, '0')}</span><div><small>{product.category || (language === 'es' ? 'Servicio' : 'Serviço')}</small><h3>{productText(product, language)}</h3><p>{product.description || (language === 'es' ? 'Atención personalizada y recomendación según tu objetivo.' : 'Atendimento personalizado e recomendação conforme seu objetivo.')}</p></div><div className="gold-service-meta"><span><Clock3 size={13} /> {product.durationMinutes ? `${product.durationMinutes} min` : 'Consultar'}</span><strong>{money(product, language)}</strong><a href={contactHref(slug, catalog, language, product.name)}>{copy.consult} <ArrowUpRight size={13} /></a></div></article>)}</div></div></section>
      <section className="gold-process"><div className="gold-gamified-wrap"><p className="gold-eyebrow">{copy.process}</p><h2 className="gold-section-title">{copy.processTitle}</h2><div className="gold-process-grid">{(language === 'es' ? [['01', 'Escribís', 'Nos contás qué buscás, sin compromiso ni apuro.'], ['02', 'Diseñamos juntas', 'Definimos el resultado antes de empezar, a tu gusto.'], ['03', 'Te vas lista', 'Con el resultado terminado, el mismo día.']] : [['01', 'Você escreve', 'Conta o que procura, sem compromisso e sem pressa.'], ['02', 'Criamos juntas', 'Definimos o resultado antes de começar, do seu jeito.'], ['03', 'Você sai pronta', 'Com o resultado finalizado no mesmo dia.']]).map(([number, title, text]) => <div className="gold-step" key={number}><b>{number}</b><h3>{title}</h3><p>{text}</p></div>)}</div></div></section>
      <section id="contacto" className="gold-contact"><div className="gold-gamified-wrap gold-contact-grid"><div><p className="gold-eyebrow">{copy.contact}</p><h2 className="gold-section-title">{copy.contact}</h2><p>{copy.contactCopy}</p><div className="gold-contact-info">{maps && <a href={maps} target="_blank" rel="noreferrer"><MapPin size={17} /> {catalog.contact.addressLabel || (language === 'es' ? 'Ver ubicación en Google Maps' : 'Ver localização no Google Maps')}</a>}{catalog.contact.hoursLabel && <span>{catalog.contact.hoursLabel}</span>}{catalog.contact.whatsappNumber && <a href={contactHref(slug, catalog, language)}><MessageCircle size={17} /> WhatsApp · {catalog.contact.whatsappNumber}</a>}</div></div><div className="gold-contact-form"><h3>{language === 'es' ? '¿Ya sabés por dónde empezar?' : 'Você já sabe por onde começar?'}</h3><p>{language === 'es' ? 'Elegí un servicio o escribinos con tu objetivo. Te respondemos con contexto.' : 'Escolha um serviço ou escreva com seu objetivo. Respondemos com contexto.'}</p><a className="gold-cta" href={contactHref(slug, catalog, language)}>{copy.whatsapp} <MessageCircle size={16} /></a></div></div></section>
      <footer className="gold-footer"><div className="gold-gamified-wrap gold-footer-inner"><span>{catalog.tenant.name}</span><span>{catalog.contact.addressLabel || 'Luque · Paraguay'}</span><a href={instagram} target="_blank" rel="noreferrer">Instagram</a></div></footer>
    </main>
  );
}
