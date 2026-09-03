import { describe, expect, it } from 'vitest';
import { reviewAutoReplyBeforeSend, PAYMENT_SENSITIVE_ESCALATION_REASON } from '../replySafetyGate';

/**
 * Achado real (03/09/2026, TASK-0238): o padrão antigo de detecção de dado
 * sensível usava um curinga `se[a-z]*na` pra pegar "seña"/"sena", mas isso
 * também batia em "semana" (s-e-m-a-n-a) — uma mensagem só perguntando por
 * disponibilidade "pra semana que vem" era escalada como se contivesse
 * pagamento/dado sensível, sem ter nada disso.
 */
describe('reviewAutoReplyBeforeSend — detecção de pagamento/dado sensível', () => {
  it('NÃO escala uma mensagem só porque menciona "semana"', async () => {
    const verdict = await reviewAutoReplyBeforeSend(
      {
        customerMessage: 'Quero agendar um Lash Lift pra semana que vem, tem horário?',
        draftBubbles: ['Temos horários disponíveis sim, qual dia da semana que vem prefere?'],
      },
      {},
    );
    expect(verdict.reason).not.toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
  });

  it('continua escalando quando a cliente menciona "seña" (sinal de pagamento)', async () => {
    const verdict = await reviewAutoReplyBeforeSend(
      {
        customerMessage: 'Ya pagué la seña, cuándo confirman?',
        draftBubbles: ['Já vou verificar com a equipe.'],
      },
      {},
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
  });

  it('continua escalando "senha"/"contraseña"', async () => {
    const verdict = await reviewAutoReplyBeforeSend(
      { customerMessage: 'te mando minha contraseña?', draftBubbles: ['Não precisa disso.'] },
      {},
    );
    expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
  });
});
