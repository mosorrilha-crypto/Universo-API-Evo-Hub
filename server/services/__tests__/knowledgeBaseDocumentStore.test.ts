/**
 * TASK-0315 (bump pdf-parse 1.1.4 -> 2.4.5, PR do Dependabot #683) — a v2
 * trocou a função direta por uma classe (`PDFParse`), quebrando
 * `tsc --noEmit` (`no default export`). Não existia nenhum teste pra
 * `extractTextFromDocument` antes desta correção — este arquivo cobre o
 * caminho de PDF de verdade (não só o tipo bater), gerando um PDF mínimo
 * válido com offsets de xref calculados em código (não à mão, pra não
 * arriscar um fixture corrompido).
 */
import { describe, expect, it } from 'vitest';
import { extractTextFromDocument } from '../knowledgeBaseDocumentStore';

function buildMinimalPdf(text: string): Buffer {
  const objs: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 400 200] /Contents 5 0 R >>',
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  objs[5] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('extractTextFromDocument', () => {
  it('extrai o texto real de um PDF (pdf-parse v2, API de classe)', async () => {
    const pdf = buildMinimalPdf('Hello Universo KB');
    const text = await extractTextFromDocument(pdf, 'application/pdf', 'doc.pdf');
    expect(text).toContain('Hello Universo KB');
  });

  it('detecta PDF pela extensão do arquivo mesmo com mimeType genérico', async () => {
    const pdf = buildMinimalPdf('Extensao');
    const text = await extractTextFromDocument(pdf, 'application/octet-stream', 'relatorio.PDF');
    expect(text).toContain('Extensao');
  });

  it('nunca lança em cima de um PDF corrompido — devolve undefined', async () => {
    const text = await extractTextFromDocument(Buffer.from('isto nao e um pdf'), 'application/pdf', 'quebrado.pdf');
    expect(text).toBeUndefined();
  });

  it('lê texto puro direto, sem passar pelo pdf-parse', async () => {
    const text = await extractTextFromDocument(Buffer.from('conteudo simples\n'), 'text/plain', 'notas.txt');
    expect(text).toBe('conteudo simples');
  });

  it('não extrai texto de tipos sem suporte (ex: docx)', async () => {
    const text = await extractTextFromDocument(Buffer.from('binario qualquer'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'contrato.docx');
    expect(text).toBeUndefined();
  });
});
