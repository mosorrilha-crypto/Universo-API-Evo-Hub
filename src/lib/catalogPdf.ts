import type { AgentProduct } from '../types';
import { apiFetch } from './apiClient';

export interface CatalogPdfContact {
  whatsappPhone?: string;
  instagramUrl?: string;
  address?: string;
  hoursLabel?: string;
}

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function slugifyFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'catalogo';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Mesma correção aplicada em `PublicCatalogPage.tsx` (`normalizeSpanishText`)
 * pra dois resquícios de português que sobraram no campo `price` de alguns
 * produtos da Monique — a tradução da TASK-0049 só cobriu `name`/`description`
 * no banco, não `price`. Mantida em espelho aqui pro PDF não voltar a mostrar
 * "varia por efeito"/"varia pela técnica" depois que a página já corrige isso.
 */
function normalizeSpanishText(value: string): string {
  return value
    .replaceAll('varia por efeito', 'varía según el efecto')
    .replaceAll('varia pela técnica', 'varía según la técnica')
    .replaceAll('varia por efecto', 'varía según el efecto');
}

function formatDurationLabel(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

const FONT_LINK_ATTR = 'data-catalog-pdf-font';
const CONTAINER_WIDTH_PX = 800;
const CAPTURE_SCALE = 2;
const IMAGE_TARGET_WIDTH = 640;
const IMAGE_TARGET_HEIGHT = 800;

/**
 * TASK-0218: a foto original passou a ficar no Storage do backend
 * (server/services/knowledgeBaseImageStore.ts), referenciada por
 * `exampleImageId` — busca via rota autenticada quando presente. Fallback
 * pro `exampleImageBase64` legado (inline, sem limite de tamanho — já
 * chegou a ~3MB numa foto real da Monique) enquanto nem todo produto foi
 * migrado.
 */
async function resolveProductImageSrc(product: AgentProduct): Promise<string | undefined> {
  if (product.exampleImageId) {
    try {
      const res = await apiFetch(`/api/knowledge-base/images/${encodeURIComponent(product.exampleImageId)}`);
      if (!res.ok) return undefined;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  }
  if (!product.exampleImageBase64) return undefined;
  return product.exampleImageBase64.startsWith('data:')
    ? product.exampleImageBase64
    : `data:${product.exampleImageMimeType || 'image/jpeg'};base64,${product.exampleImageBase64}`;
}

/**
 * Comprime no navegador (canvas, recorte 4:5 + reencode JPEG) antes de
 * entrar no PDF, senão o arquivo final ficaria pesado demais pra
 * compartilhar. Roda client-side (não no backend, como a miniatura do
 * catálogo público) porque o painel autenticado já resolve a foto original
 * (Storage ou fallback legado) — não precisa de um serviço à parte.
 *
 * 4:5 (não 4:3) de propósito: as fotos reais são tiradas na vertical, tipo
 * celular (ex: 900x1600, ~9:16) — um recorte 4:3 (paisagem) exigia cortar
 * mais da metade da altura da foto, e o resultado real (achado no catálogo
 * em produção) cortava a sobrancelha/lábio fora e sobrava só cabelo/testa.
 * 4:5 é o mesmo padrão de retrato do Instagram — exige um corte bem menor.
 */
async function compressProductImageDataUri(product: AgentProduct): Promise<string | undefined> {
  const src = await resolveProductImageSrc(product);
  if (!src) return undefined;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = IMAGE_TARGET_WIDTH;
      canvas.height = IMAGE_TARGET_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(undefined);
        return;
      }
      const targetRatio = IMAGE_TARGET_WIDTH / IMAGE_TARGET_HEIGHT;
      const sourceRatio = img.width / img.height;
      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;
      if (sourceRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, IMAGE_TARGET_WIDTH, IMAGE_TARGET_HEIGHT);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

/** Resolve a versão comprimida da foto de cada produto em paralelo, antes de montar o HTML. */
async function buildProductImageMap(products: AgentProduct[]): Promise<Map<AgentProduct, string>> {
  const map = new Map<AgentProduct, string>();
  await Promise.all(
    products.map(async (product) => {
      const dataUri = await compressProductImageDataUri(product);
      if (dataUri) map.set(product, dataUri);
    }),
  );
  return map;
}

interface BlockBounds {
  top: number;
  bottom: number;
}

/**
 * Mede, em px do canvas (já multiplicado pelo `CAPTURE_SCALE` do html2canvas),
 * os limites verticais de cada cartão marcado com `data-pdf-block`. Feito
 * antes de rasterizar, com o container ainda no layout normal do DOM — é
 * o único momento em que dá pra saber onde cada cartão começa/termina.
 */
function measureBlockBoundsPx(container: HTMLElement): BlockBounds[] {
  const containerTop = container.getBoundingClientRect().top;
  return Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-block="true"]')).map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      top: (rect.top - containerTop) * CAPTURE_SCALE,
      bottom: (rect.bottom - containerTop) * CAPTURE_SCALE,
    };
  });
}

/**
 * Dado um corte de página "ideal" (`tentativeEnd`), empurra o corte pra antes
 * de qualquer cartão que ele cortaria ao meio — o cartão inteiro vai pra
 * próxima página em vez de ficar com a borda duplicada nas duas. Só faz
 * corte "feio" (no meio do cartão mesmo) quando o cartão sozinho já é maior
 * que uma página inteira, caso em que não existe alternativa.
 */
function findSafePageBreak(srcY: number, tentativeEnd: number, blocks: BlockBounds[], canvasHeight: number): number {
  if (tentativeEnd >= canvasHeight - 0.5) return canvasHeight;
  const straddling = blocks.find((block) => block.top < tentativeEnd && block.bottom > tentativeEnd);
  if (!straddling) return tentativeEnd;
  if (straddling.top > srcY + 1) return straddling.top;
  return tentativeEnd;
}

/**
 * Injeta a mesma fonte usada no catálogo público real (Playfair Display) e
 * espera ela carregar de verdade antes de rasterizar — sem isso o
 * html2canvas captura a fonte de fallback (serif genérica), perdendo a
 * identidade visual que o pedido original queria replicar.
 */
async function ensureCatalogFontLoaded(): Promise<void> {
  if (!document.querySelector(`link[${FONT_LINK_ATTR}]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap';
    link.setAttribute(FONT_LINK_ATTR, 'true');
    document.head.appendChild(link);
  }
  try {
    await Promise.all([
      document.fonts.load('italic 700 32px "Playfair Display"'),
      document.fonts.load('400 14px "Playfair Display"'),
      document.fonts.ready,
    ]);
  } catch {
    // Melhor esforço — se a Fonts Loading API falhar/não existir, segue com
    // o fallback do navegador em vez de travar a geração do PDF.
  }
}

/**
 * Estrutura do cartão replica `.product-card` de `PublicCatalogPage.tsx`:
 * ponto decorativo + duração na linha superior, nome, preço com o rótulo
 * "Desde" (sempre presente na página real, não só quando há faixa de preço),
 * descrição, variantes e — se o tenant tem WhatsApp configurado — o mesmo
 * botão terracota "Consultar por WhatsApp" (estático aqui, já que o PDF
 * inteiro é uma imagem rasterizada sem interação possível).
 */
function buildProductCardHtml(product: AgentProduct, contact: CatalogPdfContact, imageDataUri: string | undefined): string {
  const duration = formatDurationLabel(product.durationMinutes);
  const variantsHtml = product.variants?.length
    ? `<div style="margin-top:12px;border-top:1px solid rgba(78,62,49,.12);">${product.variants
        .map(
          (variant) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(78,62,49,.12);font-size:11.5px;color:#6f6258;">
            <span>${escapeHtml(normalizeSpanishText(variant.code))}</span><strong style="color:#8d5c43;white-space:nowrap;">${escapeHtml(normalizeSpanishText(variant.price || '—'))}</strong>
          </div>`,
        )
        .join('')}</div>`
    : '';

  // Na página real esse é um link `<a>` que abre o WhatsApp — num PDF estático
  // (imagem rasterizada, nada clicável) o mesmo botão preenchido com seta ↗
  // vira uma isca visual morta: parece 100% clicável e não faz nada quando
  // tocado, repetido em cada produto do catálogo. Em vez do CTA, mostra o
  // número por extenso — informação que o cliente realmente pode usar.
  const whatsappHtml = contact.whatsappPhone
    ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(78,62,49,.12);color:#987254;font-size:11px;letter-spacing:.03em;">Consultas: WhatsApp ${escapeHtml(contact.whatsappPhone)}</div>`
    : '';

  const imageHtml = imageDataUri
    ? `<img src="${imageDataUri}" style="display:block;width:100%;height:auto;" alt="" />`
    : '';

  return `<div data-pdf-block="true" style="border:1px solid rgba(78,62,49,.15);background:#fffdf9;margin-bottom:14px;box-shadow:0 10px 26px rgba(78,62,49,.05);overflow:hidden;">
    ${imageHtml}
    <div style="padding:22px 24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;min-height:14px;color:#987254;font-size:11px;letter-spacing:.05em;">
        <span style="display:inline-block;width:7px;height:7px;border:1px solid #bc896c;border-radius:50%;"></span>
        ${duration ? `<span>${escapeHtml(duration)}</span>` : ''}
      </div>
      <div style="margin:18px 0 12px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:22px;color:#211d1a;line-height:1.05;">${escapeHtml(normalizeSpanishText(product.name))}</div>
      <div style="display:flex;align-items:baseline;gap:8px;">
        <strong style="color:#8d5c43;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:19px;font-weight:400;">${escapeHtml(normalizeSpanishText(product.price || '—'))}</strong>
        <span style="color:#987254;font-size:9px;letter-spacing:.1em;text-transform:uppercase;">Desde</span>
      </div>
      ${product.description ? `<div style="margin-top:14px;font-size:12.5px;color:#6f6258;line-height:1.65;">${escapeHtml(normalizeSpanishText(product.description))}</div>` : ''}
      ${variantsHtml}
      ${whatsappHtml}
    </div>
  </div>`;
}

const STEPS: Array<[number: string, title: string, text: string]> = [
  ['01', 'Escribís', 'Nos contás qué buscás, sin compromiso ni apuro.'],
  ['02', 'Diseñamos juntas', 'Definimos el resultado antes de empezar, a tu gusto.'],
  ['03', 'Te vas lista', 'Con el resultado terminado, el mismo día.'],
];

/**
 * Monta a página inteira replicando as seções reais de `PublicCatalogPage.tsx`
 * (cabeçalho, hero, faixa de destaques, "Cómo funciona", serviços e rodapé) —
 * não só a lista de produtos, que era o que a primeira versão deste gerador
 * cobria. Fica de fora só o que não faz sentido num PDF estático: FAQ
 * (acordeão interativo) e o botão flutuante de WhatsApp.
 */
function buildCatalogHtml(
  tenantName: string,
  contact: CatalogPdfContact,
  products: AgentProduct[],
  imageMap: Map<AgentProduct, string>,
): HTMLDivElement {
  const activeProducts = products.filter((product) => product.active !== false);

  const groups = new Map<string, AgentProduct[]>();
  for (const product of activeProducts) {
    const category = product.category?.trim() || 'Servicios';
    const items = groups.get(category) || [];
    items.push(product);
    groups.set(category, items);
  }

  const groupsHtml = [...groups.entries()]
    .map(
      ([category, items]) => `<div style="margin-bottom:32px;">
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#987254;margin-bottom:16px;">${escapeHtml(normalizeSpanishText(category))}</div>
        ${items.map((product) => buildProductCardHtml(product, contact, imageMap.get(product))).join('')}
      </div>`,
    )
    .join('');

  const stepsHtml = STEPS.map(
    ([number, title, text]) => `<div data-pdf-block="true" style="padding:18px 0;border-top:1px solid rgba(78,62,49,.3);">
      <div style="color:#b88063;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:16px;">${number}</div>
      <div style="margin:12px 0 8px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:22px;color:#211d1a;">${escapeHtml(title)}</div>
      <div style="color:#6f6258;font-size:13px;line-height:1.7;">${escapeHtml(text)}</div>
    </div>`,
  ).join('');

  const footerLines = [contact.address, contact.hoursLabel].filter((line): line is string => Boolean(line));
  const footerContact = [
    contact.whatsappPhone && `WhatsApp: ${contact.whatsappPhone}`,
    contact.instagramUrl && `Instagram: ${contact.instagramUrl}`,
  ]
    .filter((line): line is string => Boolean(line))
    .map((line) => escapeHtml(line))
    .join(' · ');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = `-${CONTAINER_WIDTH_PX + 100}px`;
  container.style.width = `${CONTAINER_WIDTH_PX}px`;
  container.innerHTML = `<div style="width:${CONTAINER_WIDTH_PX}px;background:#f3eee4;font-family:Montserrat,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#211d1a;">
    <div style="padding:24px 48px;border-bottom:1px solid rgba(78,62,49,.12);display:flex;align-items:center;gap:12px;">
      <span style="display:grid;place-items:center;width:38px;height:38px;border:1px solid #bd8a6d;border-radius:50%;color:#8d5c43;font-size:11px;letter-spacing:.08em;">MS</span>
      <span style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:20px;font-style:italic;color:#211d1a;">${escapeHtml(tenantName || 'Catálogo')}</span>
    </div>

    <div data-pdf-block="true" style="padding:64px 48px;text-align:center;background:linear-gradient(135deg,#f7f1e7 0%,#eadfce 100%);">
      <div style="color:#987254;font-size:11px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;">Estudio de micropigmentación · Luque, Paraguay</div>
      <div style="margin:20px auto 16px;max-width:620px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:50px;font-weight:700;font-style:italic;line-height:1.05;letter-spacing:-.02em;color:#211d1a;">Un trazo que no se nota como retoque.</div>
      <div style="width:130px;height:14px;margin:0 auto 20px;border-top:2px solid #c9987a;border-radius:50%;transform:rotate(-2deg);"></div>
      <div style="max-width:460px;margin:0 auto;color:#66574d;font-size:14px;line-height:1.75;">Técnica brasileña en labios y cejas. Resultado natural, ambiente privado, sin apuro.</div>
    </div>

    <div data-pdf-block="true" style="background:#c9987a;color:#fffdf9;padding:26px 48px;display:flex;flex-direction:column;gap:12px;font-size:12px;line-height:1.5;">
      <div><strong style="color:#fffdf9;">13 años</strong> de experiencia</div>
      <div><strong style="color:#fffdf9;">Técnica brasileña</strong> en labios y cejas</div>
      <div><strong style="color:#fffdf9;">Ambiente privado</strong> y sensorial</div>
      <div><strong style="color:#fffdf9;">Anestésico tópico</strong> cuando corresponde</div>
    </div>

    <div style="padding:52px 48px 8px;">
      <div style="color:#987254;font-size:11px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;">Cómo funciona</div>
      <div style="margin:12px 0 30px;max-width:520px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;font-style:italic;line-height:1.1;color:#211d1a;">De la duda al resultado, en tres pasos.</div>
      ${stepsHtml}
    </div>

    <div style="padding:52px 48px 8px;background:#f8f4ed;">
      <div style="color:#987254;font-size:11px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;">Servicios</div>
      <div style="margin:12px 0 30px;max-width:560px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;font-style:italic;line-height:1.1;color:#211d1a;">Elegí el servicio que mejor acompaña tu rutina.</div>
      ${groupsHtml || '<div style="color:#6f6258;font-size:13px;padding-bottom:40px;">Todavía no hay productos activos cargados.</div>'}
    </div>

    <div data-pdf-block="true" style="padding:32px 48px;background:#221e1a;color:#f5ebdd;">
      <div style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:19px;color:#fff7ec;">${escapeHtml(tenantName || 'Catálogo')}</div>
      ${footerLines.length ? `<div style="margin-top:8px;font-size:12px;color:#d1c1b2;line-height:1.8;">${footerLines.map((line) => escapeHtml(line)).join('<br/>')}</div>` : ''}
      ${footerContact ? `<div style="margin-top:12px;font-size:11px;color:#d4a181;letter-spacing:.03em;">${footerContact}</div>` : ''}
    </div>
  </div>`;
  return container;
}

/**
 * Gera e dispara o download de um PDF do catálogo atual — renderiza um HTML
 * com a mesma paleta/fonte do catálogo público real (`PublicCatalogPage.tsx`:
 * Playfair Display, terracota #c9987a/#8d5c43, fundo creme #f3eee4) via
 * `doc.html()` (jsPDF + html2canvas), em vez de texto puro sem identidade
 * visual. Usa os mesmos dados já carregados no painel (produtos ativos +
 * contato do catálogo público), sem depender do catálogo público estar
 * habilitado nem de uma chamada extra ao backend. Importa o jsPDF sob
 * demanda (código só usado nesta tela) pra não inflar o bundle principal
 * carregado por todo mundo.
 */
export async function downloadCatalogPdf(tenantName: string, contact: CatalogPdfContact, products: AgentProduct[]): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const [, imageMap] = await Promise.all([ensureCatalogFontLoaded(), buildProductImageMap(products)]);

  const container = buildCatalogHtml(tenantName, contact, products, imageMap);
  document.body.appendChild(container);

  try {
    // As fotos já chegam prontas como data URI (comprimidas antes de montar o
    // HTML), mas o navegador ainda precisa decodificá-las pro elemento
    // `<img>` — sem esperar isso, o html2canvas pode capturar a área da foto
    // em branco se disparar antes da decodificação terminar.
    await Promise.all(
      Array.from(container.querySelectorAll('img')).map((img) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        }),
      ),
    );

    // `doc.html()` (o wrapper de alto nível do jsPDF) testado na prática:
    // o html2canvas renderiza normalmente, mas a imagem nunca fica de fato
    // ligada aos recursos da página (`/XObject` vazio no PDF final — página
    // em branco). Monta o canvas com html2canvas direto e fatia manualmente
    // por página — caminho mais verboso, mas confirmado funcionando de
    // ponta a ponta (validado abrindo o PDF gerado).
    const blockBounds = measureBlockBoundsPx(container);

    const canvas = await html2canvas(container, {
      backgroundColor: '#f3eee4',
      scale: CAPTURE_SCALE,
      windowWidth: CONTAINER_WIDTH_PX,
      useCORS: true,
    });

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginPt = 28;
    const pageWidthPt = doc.internal.pageSize.getWidth();
    const pageHeightPt = doc.internal.pageSize.getHeight();
    const contentWidthPt = pageWidthPt - marginPt * 2;
    const pageContentHeightPt = pageHeightPt - marginPt * 2;

    const scale = contentWidthPt / canvas.width;
    const sliceHeightPx = Math.floor(pageContentHeightPt / scale);

    let srcY = 0;
    let pageIndex = 0;
    while (srcY < canvas.height - 0.5) {
      if (pageIndex > 0) doc.addPage();

      const tentativeEnd = Math.min(srcY + sliceHeightPx, canvas.height);
      const srcEnd = findSafePageBreak(srcY, tentativeEnd, blockBounds, canvas.height);
      const srcHeight = Math.max(1, Math.round(srcEnd - srcY));

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = srcHeight;
      const ctx = sliceCanvas.getContext('2d');
      if (ctx) {
        // Fundo sólido antes de desenhar — o slice fica opaco (fiel ao fundo
        // creme do catálogo) e permite JPEG em vez de PNG: um PDF de poucas
        // páginas em PNG bruto passava de 20MB (testado, 3 páginas ~25MB),
        // inviável pra baixar/mandar por WhatsApp. JPEG ~90% de qualidade
        // reduz pra poucos MB sem perda visível no texto/cores do catálogo.
        ctx.fillStyle = '#f3eee4';
        ctx.fillRect(0, 0, canvas.width, srcHeight);
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcHeight, 0, 0, canvas.width, srcHeight);
        doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.9), 'JPEG', marginPt, marginPt, contentWidthPt, srcHeight * scale);
      }

      srcY += srcHeight;
      pageIndex += 1;
    }

    doc.save(`catalogo-${slugifyFileName(tenantName)}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
