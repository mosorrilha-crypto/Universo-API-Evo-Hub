import { describe, expect, it } from 'vitest';
import { findRepeatedPhrasesAcrossResponses, isPassingEvalCase, parseGeneratedCases, parseJudgeVerdict } from '../agentEvalService';
import { PAYMENT_SENSITIVE_ESCALATION_REASON, type ReplySafetyVerdict } from '../replySafetyGate';

describe('parseGeneratedCases', () => {
  it('extrai casos válidos e descarta itens sem categoria ou texto', () => {
    const cases = parseGeneratedCases({
      cases: [
        { category: 'faq', text: '¿Cuánto cuesta las cejas?', note: 'preço direto' },
        { category: 'categoria-invalida', text: 'texto qualquer' },
        { category: 'triagem', text: '' },
        { text: 'sem categoria' },
      ],
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ category: 'faq', text: '¿Cuánto cuesta las cejas?' });
  });

  it('mantém o history quando bem formado e descarta entradas malformadas dentro dele', () => {
    const cases = parseGeneratedCases({
      cases: [
        {
          category: 'repeticao',
          text: '¿Y el precio de nuevo?',
          note: 'repete pergunta já respondida',
          history: [
            { sender: 'lead', text: '¿Cuánto cuesta?' },
            { sender: 'agent', text: 'Gs 550.000' },
            { sender: 'outro-invalido', text: 'ignorado' },
            { sender: 'lead' },
          ],
        },
      ],
    });
    expect(cases[0].history).toEqual([
      { sender: 'lead', text: '¿Cuánto cuesta?' },
      { sender: 'agent', text: 'Gs 550.000' },
    ]);
  });

  it('devolve array vazio pra entrada malformada, sem lançar', () => {
    expect(parseGeneratedCases(null)).toEqual([]);
    expect(parseGeneratedCases({})).toEqual([]);
    expect(parseGeneratedCases({ cases: 'não é array' })).toEqual([]);
  });
});

describe('parseJudgeVerdict', () => {
  it('aprova só quando passed=true E issues vazio', () => {
    expect(parseJudgeVerdict({ passed: true, issues: [] })).toEqual({ passed: true, issues: [], suggestedFix: undefined });
  });

  it('reprova quando passed=true mas issues não está vazio (evita inconsistência do modelo)', () => {
    const verdict = parseJudgeVerdict({ passed: true, issues: ['repetiu o preço já enviado'], suggestedFix: 'não repetir o preço' });
    expect(verdict.passed).toBe(false);
    expect(verdict.issues).toEqual(['repetiu o preço já enviado']);
    expect(verdict.suggestedFix).toBe('não repetir o preço');
  });

  it('trata entrada malformada como reprovado sem issues, sem lançar', () => {
    expect(parseJudgeVerdict(null)).toEqual({ passed: false, issues: [], suggestedFix: undefined });
  });

  it('aprova quando o próprio "issues" se autocontradiz concluindo que não há motivo pra reprovar (achado real 05/09/2026, TASK-0302)', () => {
    const verdict = parseJudgeVerdict({
      passed: false,
      issues: ['Vamos reavaliar com extrema atencao: ... Na verdade, a regra 1 diz explicitamente que é correto... Não há motivo para reprovar pelas regras fornecidas.'],
      suggestedFix: '',
    });
    expect(verdict).toEqual({ passed: true, issues: [], suggestedFix: undefined });
  });

  it('continua reprovando um "issues" normal, sem a autocontradição', () => {
    const verdict = parseJudgeVerdict({ passed: false, issues: ['Repetiu o preço sem reconhecer que já foi dito antes.'] });
    expect(verdict.passed).toBe(false);
    expect(verdict.issues).toEqual(['Repetiu o preço sem reconhecer que já foi dito antes.']);
  });
});

describe('isPassingEvalCase', () => {
  const approvedSafety: ReplySafetyVerdict = { approved: true, source: 'rules', severity: 'low', reason: 'ok' };
  const passingQuality = { passed: true, issues: [] };
  const failingQuality = { passed: false, issues: ['soou robótico'] };

  it('aprova quando o revisor de segurança aprova e a qualidade passa', () => {
    expect(isPassingEvalCase(approvedSafety, passingQuality)).toBe(true);
  });

  it('reprova quando o revisor de segurança aprova mas a qualidade falha', () => {
    expect(isPassingEvalCase(approvedSafety, failingQuality)).toBe(false);
  });

  it('trata o bloqueio duro de pagamento/dado sensível como escalonamento correto, não bug, quando o texto em si está ok', () => {
    const paymentBlock: ReplySafetyVerdict = { approved: false, source: 'rules', severity: 'high', reason: PAYMENT_SENSITIVE_ESCALATION_REASON };
    expect(isPassingEvalCase(paymentBlock, passingQuality)).toBe(true);
  });

  it('ainda reprova um bloqueio de pagamento se o texto em si também tiver um problema real de qualidade', () => {
    const paymentBlock: ReplySafetyVerdict = { approved: false, source: 'rules', severity: 'high', reason: PAYMENT_SENSITIVE_ESCALATION_REASON };
    expect(isPassingEvalCase(paymentBlock, failingQuality)).toBe(false);
  });

  it('reprova outros bloqueios de segurança normalmente (não é uma isenção geral pra "source: rules")', () => {
    const otherRuleBlock: ReplySafetyVerdict = { approved: false, source: 'rules', severity: 'high', reason: 'A resposta repete literalmente uma mensagem já enviada pelo agente.' };
    expect(isPassingEvalCase(otherRuleBlock, passingQuality)).toBe(false);
  });
});

describe('findRepeatedPhrasesAcrossResponses', () => {
  it('não aponta repetição de bolhas curtas (abaixo do tamanho mínimo)', () => {
    const cases = [{ bubbles: ['Sim'] }, { bubbles: ['Sim'] }, { bubbles: ['Sim'] }];
    expect(findRepeatedPhrasesAcrossResponses(cases)).toEqual([]);
  });

  it('detecta a mesma frase (ignorando maiúsculas/pontuação/acento) repetida em casos DIFERENTES', () => {
    const cases = [
      { bubbles: ['En la evaluación presencial Monique analiza tus rasgos para definir la técnica.'] },
      { bubbles: ['en la evaluación presencial Monique analiza tus rasgos para definir la técnica'] },
      { bubbles: ['En la EVALUACIÓN PRESENCIAL Monique analiza tus rasgos para definir la técnica!!'] },
      { bubbles: ['Algo completamente diferente aquí, sin relación ninguna.'] },
    ];
    const repeated = findRepeatedPhrasesAcrossResponses(cases, 3);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].count).toBe(3);
    expect(repeated[0].phrase).toContain('evaluacion presencial');
  });

  it('não conta repetição de duas bolhas dentro do MESMO caso — só entre casos diferentes', () => {
    const cases = [
      { bubbles: ['Esta frase bem longa aparece duas vezes no mesmo caso.', 'Esta frase bem longa aparece duas vezes no mesmo caso.'] },
    ];
    expect(findRepeatedPhrasesAcrossResponses(cases, 2)).toEqual([]);
  });

  it('respeita o limiar mínimo de ocorrências configurável', () => {
    const cases = [
      { bubbles: ['Frase repetida bem longa o suficiente pra contar aqui.'] },
      { bubbles: ['Frase repetida bem longa o suficiente pra contar aqui.'] },
    ];
    expect(findRepeatedPhrasesAcrossResponses(cases, 3)).toEqual([]);
    expect(findRepeatedPhrasesAcrossResponses(cases, 2)).toHaveLength(1);
  });
});
