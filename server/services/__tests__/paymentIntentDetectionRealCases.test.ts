import { describe, expect, it } from 'vitest';
import { reviewAutoReplyBeforeSend, PAYMENT_SENSITIVE_ESCALATION_REASON } from '../replySafetyGate';
import { isPaymentRelated } from '../escalationStore';

/**
 * Achado real (auditoria de 17-19/09/2026, tenant Monique — Evolution, dados
 * reais de produção via consulta somente leitura em `escalations`): duas
 * implementações independentes decidem "esta mensagem é sobre pagamento?" —
 * `isPaymentOrSensitive` em `replySafetyGate.ts` (bloqueia resposta
 * automática) e `isPaymentRelated` em `escalationStore.ts` (decide
 * escalonamento/notificação) — sem nenhuma fonte compartilhada. Este arquivo
 * documenta o comportamento ATUAL de ambas contra mensagens reais/plausíveis,
 * incluindo os casos onde elas divergem — não corrige nada ainda. A matriz de
 * decisão de intenção de pagamento (Fase 2 da auditoria) ainda depende de
 * respostas de política comercial (cartão? dinheiro? condições da seña?) que
 * não foram confirmadas pelo dono do negócio; até lá, nenhuma das duas
 * funções deve ser alterada — só testada e documentada.
 *
 * NENHUM comportamento de produção foi alterado por este arquivo.
 */
describe('Detecção de intenção de pagamento — casos reais e divergências conhecidas (sem alterar comportamento)', () => {
  describe('Caso real 1 — "Puedo con tarjeta de credito pagarte" (falso positivo confirmado no gate)', () => {
    it('o gate pré-envio bloqueia por conter "tarjeta", mesmo o rascunho sendo uma resposta de política segura', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        {
          customerMessage: 'Puedo con tarjeta de credito pagarte',
          draftBubbles: [
            'Por el momento aceptamos únicamente transferencia bancaria o efectivo, no contamos con cobro con tarjeta de crédito.',
            '¿Te queda bien alguna de esas opciones para consultar los horarios disponibles?',
          ],
        },
        {},
      );
      expect(verdict.approved).toBe(false);
      expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it('mas o fluxo de escalonamento NÃO reconhece a mesma mensagem como pagamento — divergência real confirmada', () => {
      expect(isPaymentRelated('Puedo con tarjeta de credito pagarte')).toBe(false);
    });
  });

  describe('Caso real 2 — "Al enviarle le mando el comprobante" (escalonamento legítimo)', () => {
    it('o gate pré-envio bloqueia por conter "comprobante"', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        {
          customerMessage: 'Al enviarle le mando  el comprobante',
          draftBubbles: ['Dale, quedo atenta 😊 Apenas me envíes el comprobante, verificamos y te dejamos confirmado el turno.'],
        },
        {},
      );
      expect(verdict.approved).toBe(false);
      expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it('e o fluxo de escalonamento também reconhece — aqui as duas funções concordam', () => {
      expect(isPaymentRelated('Al enviarle le mando el comprobante')).toBe(true);
    });
  });

  /**
   * Achado novo (não estava na matriz original): confirmações reais de
   * pagamento em espanhol usando conjugações de "transferir" diferentes do
   * infinitivo (ex: "transferí", 1ª pessoa do pretérito) não são reconhecidas
   * por NENHUMA das duas funções hoje — uma lacuna de SUB-detecção, mais
   * grave que os falsos positivos documentados acima porque deixa passar
   * exatamente o tipo de mensagem que a proteção existe para pegar.
   */
  describe('Lacuna real — conjugações de "transferir" fora do infinitivo/substantivo não são detectadas por nenhuma das duas funções', () => {
    // "seña"/"sena" continuam cobertas normalmente por ambas as funções — o
    // achado é especificamente sobre a forma verbal "transferí" isolada, sem
    // nenhuma outra palavra-gatilho já coberta na mesma frase.
    it.each(['Ya transferí', 'Transferí ayer', 'Ya te transferí'])(
      'gate pré-envio NÃO bloqueia "%s" hoje (nem --sensitive, nem escala)',
      async (customerMessage) => {
        const verdict = await reviewAutoReplyBeforeSend({ customerMessage, draftBubbles: ['Perfecto, gracias.'] }, {});
        expect(verdict.reason).not.toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
      },
    );

    it.each(['Ya transferí', 'Transferí ayer', 'Ya te transferí'])(
      'fluxo de escalonamento também NÃO reconhece "%s" como pagamento hoje',
      (text) => {
        expect(isPaymentRelated(text)).toBe(false);
      },
    );
  });

  /**
   * Achado novo: "pagué"/"pagué ayer" (espanhol, sem o "i" final de "paguei"
   * em português) é pego pelo gate (que remove acento antes de comparar,
   * "pagué" -> "pague" -> bate com \bpague\b) mas NÃO pelo escalonamento
   * (`pagu[eé]i` exige o "i" final, só cobre a forma portuguesa "paguei").
   * Mesma classe de divergência do caso 1, só que numa confirmação de
   * pagamento em vez de uma pergunta de política — risco maior.
   */
  describe('Divergência real — "Pagué"/"Pagué ayer" (espanhol) bloqueia no gate mas não escala', () => {
    it.each(['Pagué', 'Pagué ayer', 'Ya pagué'])('o gate pré-envio bloqueia "%s"', async (customerMessage) => {
      const verdict = await reviewAutoReplyBeforeSend({ customerMessage, draftBubbles: ['Perfecto, gracias.'] }, {});
      expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it.each(['Pagué', 'Pagué ayer', 'Ya pagué'])('mas o fluxo de escalonamento NÃO reconhece "%s" (só cobre "paguei", forma portuguesa)', (text) => {
      expect(isPaymentRelated(text)).toBe(false);
    });
  });

  describe('Confirmação: "¿Puedo pagar en efectivo?" não é tratado como sensível por nenhuma das duas funções', () => {
    it('o gate pré-envio não bloqueia', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        { customerMessage: '¿Puedo pagar en efectivo?', draftBubbles: ['Sí, aceptamos efectivo también.'] },
        {},
      );
      expect(verdict.reason).not.toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it('o fluxo de escalonamento não reconhece como pagamento', () => {
      expect(isPaymentRelated('¿Puedo pagar en efectivo?')).toBe(false);
    });
  });
});
