/**
 * Parser CSV mínimo pra importação de listas de contatos de disparo em
 * massa (TASK-0171) — sem dependência nova. Colunas `phone`/`name` são
 * obrigatórias (nome da coluna é case-insensitive); qualquer outra coluna
 * vira `variables` livre, usada como parâmetro de corpo do Template na hora
 * do envio.
 *
 * Dedupe já aqui: uma lista com o mesmo telefone repetido (erro comum de
 * exportação de planilha) mantém só a 1ª ocorrência — evita criar 2
 * contatos pro mesmo número ou falhar a importação inteira por causa da
 * constraint unique(list_id, phone).
 */

export const MAX_CSV_BASE64_LENGTH = 10 * 1024 * 1024; // ~10MB de base64
export const MAX_CSV_ROWS = 10_000;

export interface ParsedCsvContact {
  phone: string;
  name: string | null;
  variables: Record<string, string>;
}

export interface ParsedCsvResult {
  contacts: ParsedCsvContact[];
  duplicatesIgnored: number;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Normaliza um telefone só pra fins de deduplicação (remove espaços/símbolos comuns) — não valida formato internacional, isso é responsabilidade de quem monta a lista. */
function normalizePhoneForDedupe(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function parseContactsCsv(csvText: string): ParsedCsvResult {
  const lines = csvText.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('CSV vazio — nenhuma linha encontrada.');
  }

  const header = parseCsvLine(lines[0]).map((col) => col.toLowerCase());
  const phoneIdx = header.indexOf('phone');
  const nameIdx = header.indexOf('name');
  if (phoneIdx === -1) {
    throw new Error('CSV precisa ter uma coluna "phone".');
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_CSV_ROWS) {
    throw new Error(`CSV com ${dataLines.length} linhas — máximo permitido é ${MAX_CSV_ROWS}. Divida em vários arquivos/campanhas.`);
  }

  const seen = new Set<string>();
  const contacts: ParsedCsvContact[] = [];
  let duplicatesIgnored = 0;

  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    const rawPhone = fields[phoneIdx]?.trim();
    if (!rawPhone) continue;

    const dedupeKey = normalizePhoneForDedupe(rawPhone);
    if (!dedupeKey) continue;
    if (seen.has(dedupeKey)) {
      duplicatesIgnored++;
      continue;
    }
    seen.add(dedupeKey);

    const variables: Record<string, string> = {};
    header.forEach((col, idx) => {
      if (idx === phoneIdx || idx === nameIdx) return;
      const value = fields[idx];
      if (value !== undefined && value !== '') variables[col] = value;
    });

    contacts.push({
      phone: rawPhone,
      name: nameIdx !== -1 ? fields[nameIdx]?.trim() || null : null,
      variables,
    });
  }

  return { contacts, duplicatesIgnored };
}
