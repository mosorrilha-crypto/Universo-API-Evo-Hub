/**
 * Etapa 3 do agente vertical (docs/AGENTE-VERTICAL-ARQUITETURA.md, seções 1 e
 * 7): o prompt de resposta do especialista deixou de ser uma string única
 * concatenada — camadas 1+2 (global/segmento, fixas) vão em
 * `systemInstruction`, camadas 3+4 (tenant/dinâmico) + histórico vão em
 * `contents`. Este teste trava essa separação: se alguém voltar a
 * concatenar tudo numa string só, ele quebra.
 */
import { describe, expect, it } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { generateAutoReplyForText } from '../autoReply';

const KB_MARKER = 'Retoque Gs 150.000 — MARCADOR-DE-BASE-DE-CONHECIMENTO';
const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Oi! O retoque sai Gs 150.000.'], needsHumanConfirmation: false };

function makeFakeAi() {
  const calls: any[] = [];
  const ai = {
    models: {
      generateContent: async (req: any) => {
        calls.push(req);
        const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
        if (isRouterCall) return { text: JSON.stringify({ agent: 'faq' }) } as any;
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, calls };
}

describe('generateAutoReplyForText — camadas do prompt (Etapa 3)', () => {
  it('manda camada global/segmento em systemInstruction, e tenant/dinâmico/histórico em contents', async () => {
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText(
      'tenant-a',
      ai,
      'quanto custa o retoque?',
      'Cliente Teste',
      KB_MARKER,
      [{ sender: 'lead', text: 'oi' }],
      undefined,
      undefined,
      'beauty_studio'
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles).toEqual(SPECIALIST_REPLY.bubbles);

    const specialistCall = calls[1];
    const systemInstruction: string = specialistCall.config.systemInstruction;
    const userContent: string = specialistCall.contents[0].text;

    // Camada 1 (global): regras fixas, nunca dado do tenant.
    expect(systemInstruction).toContain('REGRAS DE ESTILO');
    expect(systemInstruction).not.toContain(KB_MARKER);

    // Camadas 3+4 (tenant/dinâmico) + histórico: nunca a instrução fixa.
    expect(userContent).toContain(KB_MARKER);
    expect(userContent).toContain('quanto custa o retoque?');
    expect(userContent).not.toContain('REGRAS DE ESTILO');
  });

  it('usa o segmento default (beauty_studio) quando o chamador não passa nenhum', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    expect(calls[1].config.systemInstruction).toBeTruthy();
  });
});
