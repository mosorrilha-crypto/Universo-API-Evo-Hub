import type { AgentProduct } from '../types';

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

function buildProductCardHtml(product: AgentProduct): string {
  const duration = formatDurationLabel(product.durationMinutes);
  const variantsHtml = product.variants?.length
    ? `<div style="margin-top:12px;border-top:1px solid rgba(78,62,49,.12);">${product.variants
        .map(
          (variant) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(78,62,49,.12);font-size:11.5px;color:#6f6258;">
            <span>${escapeHtml(variant.code)}</span><strong style="color:#8d5c43;white-space:nowrap;">${escapeHtml(variant.price || '—')}</strong>
          </div>`,
        )
        .join('')}</div>`
    : '';

  return `<div data-pdf-block="true" style="border:1px solid rgba(78,62,49,.15);background:#fffdf9;padding:20px 22px;margin-bottom:14px;box-shadow:0 10px 26px rgba(78,62,49,.05);">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;">
      <div style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:20px;color:#211d1a;line-height:1.2;">${escapeHtml(product.name)}</div>
      <div style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:18px;color:#8d5c43;white-space:nowrap;">${escapeHtml(product.price || '—')}</div>
    </div>
    ${duration ? `<div style="margin-top:5px;font-size:10px;color:#987254;letter-spacing:.05em;text-transform:uppercase;">${escapeHtml(duration)}</div>` : ''}
    ${product.description ? `<div style="margin-top:10px;font-size:12.5px;color:#6f6258;line-height:1.65;">${escapeHtml(product.description)}</div>` : ''}
    ${variantsHtml}
  </div>`;
}

function buildCatalogHtml(tenantName: string, contact: CatalogPdfContact, products: AgentProduct[]): HTMLDivElement {
  const activeProducts = products.filter((product) => product.active !== false);

  const groups = new Map<string, AgentProduct[]>();
  for (const product of activeProducts) {
    const category = product.category?.trim() || 'Servicios';
    const items = groups.get(category) || [];
    items.push(product);
    groups.set(category, items);
  }

  const contactLines = [
    contact.whatsappPhone && `WhatsApp: ${contact.whatsappPhone}`,
    contact.instagramUrl && `Instagram: ${contact.instagramUrl}`,
    contact.address && contact.address,
    contact.hoursLabel && contact.hoursLabel,
  ].filter((line): line is string => Boolean(line));

  const groupsHtml = [...groups.entries()]
    .map(
      ([category, items]) => `<div style="margin-bottom:32px;">
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#987254;margin-bottom:14px;">${escapeHtml(category)}</div>
        ${items.map(buildProductCardHtml).join('')}
      </div>`,
    )
    .join('');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = `-${CONTAINER_WIDTH_PX + 100}px`;
  container.style.width = `${CONTAINER_WIDTH_PX}px`;
  container.innerHTML = `<div style="width:${CONTAINER_WIDTH_PX}px;background:#f3eee4;font-family:Montserrat,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#211d1a;">
    <div style="padding:44px 48px 26px;border-bottom:1px solid rgba(78,62,49,.15);">
      <div style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-style:italic;font-weight:700;font-size:36px;color:#211d1a;line-height:1.05;">${escapeHtml(tenantName || 'Catálogo')}</div>
      <div style="margin-top:8px;color:#987254;font-size:11px;letter-spacing:.14em;text-transform:uppercase;">Catálogo de servicios</div>
    </div>
    ${
      contactLines.length
        ? `<div style="padding:18px 48px;font-size:12px;color:#6f6258;line-height:1.9;border-bottom:1px solid rgba(78,62,49,.15);">${contactLines.map((line) => escapeHtml(line)).join('<br/>')}</div>`
        : ''
    }
    <div style="padding:36px 48px 8px;">
      ${groupsHtml || '<div style="color:#6f6258;font-size:13px;">Todavía no hay productos activos cargados.</div>'}
    </div>
    <div style="padding:28px 48px;background:#221e1a;color:#f5ebdd;">
      <div style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:17px;color:#fff7ec;">${escapeHtml(tenantName || 'Catálogo')}</div>
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
  await ensureCatalogFontLoaded();

  const container = buildCatalogHtml(tenantName, contact, products);
  document.body.appendChild(container);

  try {
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
