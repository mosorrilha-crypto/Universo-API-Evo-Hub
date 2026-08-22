import { describe, expect, it } from 'vitest';
import { buildChronologicalConversationContext, guardContinuationReply } from './conversationReplyGuard';

const continuation = [
  { sender: 'agent', text: 'El Combo Full Face incluye cejas, labios y pestañas.', timestamp: '2026-08-21T20:48:00Z' },
  { sender: 'lead', text: 'Y ese cuanto año dura', timestamp: '2026-08-21T20:52:00Z' },
];

describe('guardião de resposta de continuidade', () => {
  it('ordena o histórico e identifica quem falou em cada mensagem', () => {
    const reversed = [...continuation].reverse();
    expect(buildChronologicalConversationContext(reversed)).toBe('1. ATENDIMENTO: El Combo Full Face incluye cejas, labios y pestañas.\n2. CLIENTE: Y ese cuanto año dura');
  });

  it('substitui uma saudação repetida por uma resposta contextual em espanhol', () => {
    const result = guardContinuationReply({ suggestedSmartReply: '¡Hola! Soy Ana, la asistente de Monique. ¿Cómo te ayudo?' }, continuation);
    expect(result.detectedLanguage).toBe('Español');
    expect(result.suggestedSmartReply).toContain('duración');
    expect(result.suggestedSmartReply).not.toContain('Soy Ana');
  });

  it('preserva respostas que já atendem à continuidade sem uma nova apresentação', () => {
    const draft = 'Cada procedimiento tiene una duración diferente; ¿te refieres a cejas, labios o pestañas?';
    expect(guardContinuationReply({ suggestedSmartReply: draft }, continuation).suggestedSmartReply).toBe(draft);
  });
});
