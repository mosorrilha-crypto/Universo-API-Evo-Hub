import type { AgentProduct } from '../types';

export interface CatalogPdfContact {
  whatsappPhone?: string;
  instagramUrl?: string;
  address?: string;
  hoursLabel?: string;
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function slugifyFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'catalogo';
}

/**
 * Gera e dispara o download de um PDF do catálogo atual — usa os mesmos
 * dados já carregados no painel (produtos ativos + contato do catálogo
 * público), sem depender do catálogo público estar habilitado nem de uma
 * chamada extra ao backend. Importa o jsPDF sob demanda (código só usado
 * nesta tela) pra não inflar o bundle principal carregado por todo mundo.
 */
export async function downloadCatalogPdf(tenantName: string, contact: CatalogPdfContact, products: AgentProduct[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(tenantName || 'Catálogo', MARGIN, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text('Catálogo de produtos e serviços', MARGIN, y);
  y += 8;

  const contactLines = [
    contact.whatsappPhone && `WhatsApp: ${contact.whatsappPhone}`,
    contact.instagramUrl && `Instagram: ${contact.instagramUrl}`,
    contact.address && `Endereço: ${contact.address}`,
    contact.hoursLabel && `Horário: ${contact.hoursLabel}`,
  ].filter((line): line is string => Boolean(line));

  if (contactLines.length) {
    doc.setFontSize(9.5);
    contactLines.forEach((line) => {
      doc.text(line, MARGIN, y);
      y += 5;
    });
    y += 2;
  }

  doc.setDrawColor(210, 210, 210);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 8;

  const activeProducts = products.filter((product) => product.active !== false);

  if (!activeProducts.length) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(11);
    doc.text('Nenhum produto ativo cadastrado ainda.', MARGIN, y);
  }

  activeProducts.forEach((product) => {
    ensureSpace(16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(20, 20, 20);
    const nameLine = product.category ? `${product.name}  ·  ${product.category}` : product.name;
    doc.text(nameLine, MARGIN, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(16, 122, 87);
    doc.text(product.price || '—', PAGE_WIDTH - MARGIN, y, { align: 'right' });
    y += 6;

    if (product.durationMinutes) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Duração: ${product.durationMinutes} min`, MARGIN, y);
      y += 5;
    }

    if (product.description) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(70, 70, 70);
      const wrapped = doc.splitTextToSize(product.description, CONTENT_WIDTH) as string[];
      wrapped.forEach((line) => {
        ensureSpace(6);
        doc.text(line, MARGIN, y);
        y += 5;
      });
    }

    if (product.variants?.length) {
      product.variants.forEach((variant) => {
        ensureSpace(6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(90, 90, 90);
        doc.text(`• ${variant.code}`, MARGIN + 3, y);
        doc.text(variant.price || '—', PAGE_WIDTH - MARGIN, y, { align: 'right' });
        y += 5;
      });
    }

    y += 5;
    doc.setDrawColor(235, 235, 235);
    doc.line(MARGIN, y - 2, PAGE_WIDTH - MARGIN, y - 2);
  });

  doc.save(`catalogo-${slugifyFileName(tenantName)}.pdf`);
}
