/**
 * Regressão: a Monique tem clientela bilíngue (es-PY principal, pt-BR
 * secundário — ver supabase/migrations/0001). Antes desta correção, a
 * detecção de mensagem sobre pagamento só cobria a grafia em espanhol, então
 * uma cliente brasileira mandando "aqui está o comprovante da transferência"
 * nunca disparava o escalonamento pra verificação humana.
 */
import { describe, expect, it } from 'vitest';
import { isPaymentRelated } from '../escalationStore';

describe('isPaymentRelated', () => {
  it('detecta em espanhol', () => {
    expect(isPaymentRelated('te mando el comprobante de la transferencia')).toBe(true);
    expect(isPaymentRelated('ya pagué la seña')).toBe(true);
    expect(isPaymentRelated('hice el depósito')).toBe(true);
  });

  it('detecta em português (clientela brasileira da Monique)', () => {
    expect(isPaymentRelated('aqui está o comprovante da transferência')).toBe(true);
    expect(isPaymentRelated('já paguei o sinal')).toBe(true);
    expect(isPaymentRelated('fiz o depósito agora')).toBe(true);
  });

  it('não dispara em mensagem sem relação com pagamento', () => {
    expect(isPaymentRelated('quanto custa o microlips?')).toBe(false);
    expect(isPaymentRelated('¿tenés horario el viernes?')).toBe(false);
  });
});
