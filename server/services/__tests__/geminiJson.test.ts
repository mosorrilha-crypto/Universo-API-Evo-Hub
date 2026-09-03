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

  it('conserta chave de objeto sem aspas (reprodução exata do erro real: "Expected double-quoted property name in JSON")', () => {
    expect(safeParseGeminiJson('{passed: true, issues: []}')).toEqual({ passed: true, issues: [] });
  });

  it('conserta chave sem aspas mesmo com valores string/aninhados', () => {
    const raw = '{passed: false, issues: ["soou robótico"], suggestedFix: "responda direto"}';
    expect(safeParseGeminiJson(raw)).toEqual({ passed: false, issues: ['soou robótico'], suggestedFix: 'responda direto' });
  });

  it('relança o erro original quando não há nenhum bloco { no texto', () => {
    expect(() => safeParseGeminiJson('não gerei JSON nenhum dessa vez')).toThrow();
  });

  it('relança o erro original quando o JSON está truncado/cortado (nenhuma camada de recuperação consegue consertar)', () => {
    expect(() => safeParseGeminiJson('{"passed": true, "issues": ["texto cortado no meio')).toThrow();
  });
});
