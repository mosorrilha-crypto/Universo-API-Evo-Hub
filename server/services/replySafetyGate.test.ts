import { describe, expect, it, vi } from 'vitest';
import { reviewAutoReplyBeforeSend } from './replySafetyGate';

describe('revisor pré-envio de respostas automáticas', () => {
  it('bloqueia uma apresentação repetida em conversa em andamento sem chamar outro modelo', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Y ese cuanto año dura?',
      draftBubbles: ['¡Hola! Soy Ana, la asistente de Monique. ¿Cómo te ayudo?'],
      history: [{ sender: 'agent', text: 'El Combo Full Face incluye cejas, labios y pestañas.' }],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.source).toBe('rules');
    expect(verdict.reason).toContain('reinicia o atendimento');
  });

  it('bloqueia convite de agenda após pergunta puramente factual', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Cuánto dura el procedimiento de cejas?',
      draftBubbles: ['Dura aproximadamente un año. ¿Agendamos tu turno?'],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.source).toBe('rules');
    expect(verdict.reason).toContain('agenda');
  });

  it('bloqueia quando nenhum revisor independente está disponível', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Hola, cuánto cuesta?',
      draftBubbles: ['El valor es el que figura en nuestro catálogo.'],
    }, { ai: null });

    expect(verdict).toMatchObject({ approved: false, source: 'unavailable', severity: 'high' });
  });

  it('aceita a aprovação estruturada do segundo agente', async () => {
    const ai: any = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Resposta contextual e respaldada.' }) }),
      },
    };
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Hola, cuánto dura?',
      draftBubbles: ['Cada procedimiento tiene una duración diferente. ¿Te referís a cejas, labios o pestañas?'],
      history: [{ sender: 'agent', text: 'El Combo Full Face incluye cejas, labios y pestañas.' }],
    }, { ai });

    expect(verdict).toMatchObject({ approved: true, source: 'gemini-reviewer', severity: 'low' });
  });
});
