/**
 * Lembrete de fechamento manual (pedido real, 15/08/2026 — auditoria de
 * conversas reais mostrou um operador fechando verbalmente no chat sem
 * clicar no botão real de Agendamento Manual, e o fechamento nunca virava
 * um evento de verdade no Google Calendar). looksLikeClosingConfirmation é
 * só uma heurística pra SUGERIR o lembrete — nunca precisa ser perfeita,
 * mas não pode disparar em qualquer mensagem trivial.
 */
import { describe, expect, it } from 'vitest';
import { looksLikeClosingConfirmation } from '../WhatsAppLeadsSim';

describe('looksLikeClosingConfirmation', () => {
  it('detecta frases reais de confirmação vistas em produção', () => {
    expect(looksLikeClosingConfirmation('Podemos dejar reservada tu fecha ❤️')).toBe(true);
    expect(looksLikeClosingConfirmation('¡Listo! Quedaste confirmada para el sábado a las 14h.')).toBe(true);
    expect(looksLikeClosingConfirmation('Ya te agendé para el lunes.')).toBe(true);
    expect(looksLikeClosingConfirmation('Te anotamos el turno del viernes.')).toBe(true);
  });

  it('não dispara em mensagens triviais do dia a dia', () => {
    expect(looksLikeClosingConfirmation('¡Hola! ¿Cómo estás?')).toBe(false);
    expect(looksLikeClosingConfirmation('El valor es Gs 500.000, ¿te interesa?')).toBe(false);
    expect(looksLikeClosingConfirmation('¡Que tengas un lindo día!')).toBe(false);
    expect(looksLikeClosingConfirmation('Dale, quedo atenta a tu respuesta.')).toBe(false);
  });
});
