import { describe, expect, it } from 'vitest';
import { safeParseGeminiJson } from '../geminiJson';

describe('safeParseGeminiJson', () => {
  it('faz o parse normal de um JSON válido', () => {
    expect(safeParseGeminiJson('{"passed":true,"issues":[]}')).toEqual({ passed: true, issues: [] });
  });

  it('devolve objeto vazio pra texto vazio/ausente', () => {
    expect(safeParseGeminiJson('')).toEqual({});
    expect(safeParseGeminiJson(undefined)).toEqual({});
    expect(safeParseGeminiJson(null)).toEqual({});
  });

  it('recupera um bloco JSON válido cercado de texto/markdown extra', () => {
    const raw = '```json\n{"passed":false,"issues":["repetiu o preço"]}\n```';
    expect(safeParseGeminiJson(raw)).toEqual({ passed: false, issues: ['repetiu o preço'] });
  });

  it('recupera o primeiro bloco {...} balanceado mesmo com texto antes e depois', () => {
    const raw = 'Aquí está mi respuesta: {"passed":true,"issues":[]} espero que ayude!';
    expect(safeParseGeminiJson(raw)).toEqual({ passed: true, issues: [] });
  });

  it('relança o erro original quando o JSON está genuinamente malformado, em vez de mascarar com um objeto vazio', () => {
    expect(() => safeParseGeminiJson('{passed: true, issues: []}')).toThrow();
  });

  it('relança o erro original quando não há nenhum bloco { no texto', () => {
    expect(() => safeParseGeminiJson('não gerei JSON nenhum dessa vez')).toThrow();
  });
});
