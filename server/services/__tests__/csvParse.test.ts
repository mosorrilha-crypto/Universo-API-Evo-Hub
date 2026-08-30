import { describe, expect, it } from 'vitest';
import { parseContactsCsv, MAX_CSV_ROWS } from '../csvParse';

describe('parseContactsCsv', () => {
  it('faz o parse básico de phone/name + variáveis extras', () => {
    const result = parseContactsCsv('phone,name,distancia\n595981111111,Maria,5km\n595982222222,João,3km');
    expect(result.contacts).toEqual([
      { phone: '595981111111', name: 'Maria', variables: { distancia: '5km' } },
      { phone: '595982222222', name: 'João', variables: { distancia: '3km' } },
    ]);
    expect(result.duplicatesIgnored).toBe(0);
  });

  it('suporta campos entre aspas com vírgula dentro', () => {
    const result = parseContactsCsv('phone,name\n595981111111,"Silva, Maria"');
    expect(result.contacts[0].name).toBe('Silva, Maria');
  });

  it('deduplica telefone repetido dentro do mesmo CSV, mantendo a 1ª ocorrência', () => {
    const result = parseContactsCsv('phone,name\n595981111111,Maria\n595981111111,Maria Duplicada\n595982222222,João');
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0].name).toBe('Maria');
    expect(result.duplicatesIgnored).toBe(1);
  });

  it('trata telefones com formatação diferente (espaços/traços) como o mesmo pra fins de dedupe', () => {
    const result = parseContactsCsv('phone,name\n(595) 98-111-1111,Maria\n595981111111,Maria de novo');
    expect(result.contacts).toHaveLength(1);
    expect(result.duplicatesIgnored).toBe(1);
  });

  it('lança erro claro quando falta a coluna "phone"', () => {
    expect(() => parseContactsCsv('name,age\nMaria,30')).toThrow(/coluna "phone"/);
  });

  it('lança erro quando o CSV está vazio', () => {
    expect(() => parseContactsCsv('')).toThrow();
  });

  it('ignora linhas sem telefone', () => {
    const result = parseContactsCsv('phone,name\n,Sem Telefone\n595981111111,Com Telefone');
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].name).toBe('Com Telefone');
  });

  it('lança erro quando o CSV ultrapassa MAX_CSV_ROWS', () => {
    const header = 'phone,name';
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `59598${String(i).padStart(7, '0')},Contato ${i}`);
    expect(() => parseContactsCsv([header, ...rows].join('\n'))).toThrow(/máximo permitido/);
  });
});
