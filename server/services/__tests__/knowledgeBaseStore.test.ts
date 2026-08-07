/**
 * Achado numa auditoria pós-lançamento: formatKnowledgeBaseForPrompt nunca
 * lia kb.businessModel — endereço, horário em texto e Instagram nunca
 * chegavam no prompt do Gemini, quebrando perguntas de FAQ reais tipo
 * "a que horas abrem?"/"onde fica?".
 */
import { describe, expect, it } from 'vitest';
import { formatKnowledgeBaseForPrompt, type AgentKnowledgeBase } from '../knowledgeBaseStore';

describe('formatKnowledgeBaseForPrompt', () => {
  it('inclui businessModel (endereço/horário/posicionamento) no texto do prompt', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Estúdio Teste',
      businessModel: 'Luque, Paraguai. Horário: segunda a sexta 07:30–20:00. Instagram: @teste',
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).toContain('Luque, Paraguai');
    expect(text).toContain('07:30–20:00');
    expect(text).toContain('@teste');
  });

  it('não quebra quando businessModel está ausente', () => {
    const kb: AgentKnowledgeBase = { companyName: 'Estúdio Teste' };
    expect(() => formatKnowledgeBaseForPrompt(kb)).not.toThrow();
  });
});
