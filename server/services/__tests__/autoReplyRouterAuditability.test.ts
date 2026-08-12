/**
 * Issue #99: `classifyAgent` (router leve) devolvia só `{"agent": "..."}` —
 * sem `confidence` nem `reasoning`, um misroteamento (ex: reclamação
 * classificada como faq) ficava invisível sem reconstruir manualmente a
 * conversa inteira. Este teste trava que o schema do router agora pede
 * confidence+reasoning, e que os dois são logados (auditável), sem mudar a
 * decisão de roteamento em si (mesmo `agent` que o modelo devolveu, com o
 * mesmo fallback pra "triagem" quando inválido/ausente).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia: vi.fn(), sendWhatsAppMediaMessage: vi.fn() }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage: vi.fn(async () => ({}) as any) }));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => ({ products: [] })),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const SPECIALIST_REPLY = { phase: 'objecao', bubbles: ['Sinto muito por isso, vou confirmar com cuidado.'], needsHumanConfirmation: false };

function makeFakeAi(routerResponse: any) {
  const calls: any[] = [];
  const ai = {
    models: {
      generateContent: async (req: any) => {
        calls.push(req);
        const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
        if (isRouterCall) return { text: JSON.stringify(routerResponse) } as any;
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, calls };
}

describe('classifyAgent — auditabilidade do roteamento (issue #99)', () => {
  it('pede confidence e reasoning no prompt do router', async () => {
    const { ai, calls } = makeFakeAi({ agent: 'faq', confidence: 0.9, reasoning: 'Pergunta direta sobre preço.' });
    await generateAutoReplyForText('tenant-a', ai, 'quanto custa o retoque?', 'Cliente Teste');
    const routerPrompt: string = calls[0].contents[0].text;
    expect(routerPrompt).toContain('"confidence"');
    expect(routerPrompt).toContain('"reasoning"');
  });

  it('loga tenantId/phone/agent/confidence/reasoning quando o router devolve os três campos', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ai } = makeFakeAi({ agent: 'reclamacao', confidence: 0.82, reasoning: 'Cliente relata dor após o procedimento.' });

    const result = await generateAutoReplyForText('tenant-a', ai, 'fiquei com muita dor depois do procedimento', 'Cliente Teste', undefined, undefined, '595981234567');

    expect(result?.agent).toBe('reclamacao');
    const routerLog = logSpy.mock.calls.map((args) => args.join(' ')).find((line) => line.includes('[Router]'));
    expect(routerLog).toBeTruthy();
    expect(routerLog).toContain('tenant=tenant-a');
    expect(routerLog).toContain('phone=595981234567');
    expect(routerLog).toContain('agent=reclamacao');
    expect(routerLog).toContain('confidence=0.82');
    expect(routerLog).toContain('reasoning="Cliente relata dor após o procedimento."');

    logSpy.mockRestore();
  });

  it('não muda a decisão de roteamento: usa o agent devolvido mesmo com confidence/reasoning presentes', async () => {
    const { ai } = makeFakeAi({ agent: 'agendamento', confidence: 0.65, reasoning: 'Cliente pediu horário específico.' });
    const result = await generateAutoReplyForText('tenant-a', ai, 'quero marcar sexta às 15h', 'Cliente Teste');
    expect(result?.agent).toBe('agendamento');
  });

  it('mantém o fallback pra "triagem" quando o agent vem inválido, mesmo com confidence/reasoning presentes', async () => {
    const { ai } = makeFakeAi({ agent: 'algo-invalido', confidence: 0.3, reasoning: 'Não ficou claro.' });
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', 'Cliente Teste');
    expect(result?.agent).toBe('triagem');
  });

  it('não quebra quando o router não devolve confidence/reasoning (compatibilidade com resposta antiga)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ai } = makeFakeAi({ agent: 'faq' });

    const result = await generateAutoReplyForText('tenant-a', ai, 'quanto custa?', 'Cliente Teste');

    expect(result?.agent).toBe('faq');
    const routerLog = logSpy.mock.calls.map((args) => args.join(' ')).find((line) => line.includes('[Router]'));
    expect(routerLog).toContain('confidence=-');
    expect(routerLog).toContain('reasoning="-"');

    logSpy.mockRestore();
  });
});
