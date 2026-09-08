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

  // TASK-0315 (pedido direto: "as vezes me parecem fora de contexto com o
  // histórico do chat, principalmente o de retomada") — os endpoints
  // auxiliares da Ficha IA (reply-from-hint, ask) mandavam a conversa
  // INTEIRA sem limite (achado real: conversas de produção chegam a 255
  // mensagens). windowSize mantém só as N mais recentes, na mesma ordem.
  it('windowSize mantém só as N mensagens mais recentes, sem perder a ordem cronológica', () => {
    const long = Array.from({ length: 5 }, (_, i) => ({
      sender: i % 2 === 0 ? 'lead' : 'agent',
      text: `msg-${i}`,
      timestamp: `2026-08-21T20:${String(48 + i).padStart(2, '0')}:00Z`,
    }));

    expect(buildChronologicalConversationContext(long, 2)).toBe('1. ATENDIMENTO: msg-3\n2. CLIENTE: msg-4');
    // sem windowSize (ou 0/negativo), mantém o comportamento anterior — histórico completo.
    expect(buildChronologicalConversationContext(long)).toContain('msg-0');
    expect(buildChronologicalConversationContext(long, 0)).toContain('msg-0');
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
