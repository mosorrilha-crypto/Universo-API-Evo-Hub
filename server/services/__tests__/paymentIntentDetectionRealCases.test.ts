import { describe, expect, it } from 'vitest';
import { reviewAutoReplyBeforeSend, PAYMENT_SENSITIVE_ESCALATION_REASON, PAYMENT_RECEIPT_ACKNOWLEDGMENT_TEXT } from '../replySafetyGate';
import { isPaymentRelated } from '../escalationStore';

/**
 * Achado real (auditoria de 17-19/09/2026, tenant Monique — Evolution, dados
 * reais de produção via consulta somente leitura em `escalations`): duas
 * implementações independentes decidiam "esta mensagem é sobre pagamento?" —
 * `isPaymentOrSensitive` em `replySafetyGate.ts` (bloqueia resposta
 * automática) e `isPaymentRelated` em `escalationStore.ts` (decide
 * escalonamento/notificação) — sem nenhuma fonte compartilhada, e
 * divergiam em pelo menos dois casos reais.
 *
 * TASK-0440 (19/09/2026) documentou o comportamento ANTIGO (com o falso
 * positivo e a lacuna ainda presentes). TASK-0441 (mesmo dia, depois da
 * matriz de decisão de intenção de pagamento ser aprovada pelo dono do
 * negócio — cartão nunca aceito, dinheiro em todos os serviços,
 * transferência sempre aceita, valor da seña e dados bancários podem ser
 * informados automaticamente, comprovante recebe reconhecimento neutro)
 * corrigiu o código. Este arquivo agora documenta o comportamento
 * CORRIGIDO — os casos abaixo substituem os equivalentes de
 * `paymentIntentDetectionRealCases.test.ts` anteriores à correção.
 */
describe('Detecção de intenção de pagamento — casos reais, corrigidos após a matriz de decisão (TASK-0441)', () => {
  describe('Caso real 1 — "Puedo con tarjeta de credito pagarte" (falso positivo corrigido)', () => {
    it('o gate pré-envio NÃO bloqueia mais por pagamento sensível (cartão nunca aceito é resposta de política, não exige revisão humana)', async () => {
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
      // Sem Groq/Gemini configurado neste teste, o revisor cai no fallback
      // "indisponível" (bloqueia por segurança) — o que importa aqui é que
      // NÃO é mais o bloqueio determinístico de pagamento sensível.
      expect(verdict.reason).not.toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it('e o fluxo de escalonamento também não reconhece como pagamento — divergência real do TASK-0440 corrigida (as duas funções concordam agora)', () => {
      expect(isPaymentRelated('Puedo con tarjeta de credito pagarte')).toBe(false);
    });
  });

  describe('Caso real 2 — "Al enviarle le mando el comprobante" (aprovado com reconhecimento neutro, ainda escala para humano)', () => {
    it('o gate pré-envio aprova com um reconhecimento neutro (não confirma pagamento nem turno) em vez de ficar em silêncio total', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        {
          customerMessage: 'Al enviarle le mando  el comprobante',
          draftBubbles: ['Dale, quedo atenta 😊 Apenas me envíes el comprobante, verificamos y te dejamos confirmado el turno.'],
        },
        {},
      );
      expect(verdict.approved).toBe(true);
      expect(verdict.correctedBubbles).toEqual([PAYMENT_RECEIPT_ACKNOWLEDGMENT_TEXT]);
      expect(verdict.stillRequiresHumanReview).toBe(true);
    });

    it('e o fluxo de escalonamento continua reconhecendo — a verificação humana do comprovante nunca deixou de acontecer', () => {
      expect(isPaymentRelated('Al enviarle le mando el comprobante')).toBe(true);
    });
  });

  /**
   * Achado novo do TASK-0440, fechado aqui: confirmações reais de pagamento
   * em espanhol usando conjugações de "transferir" diferentes do infinitivo
   * (ex: "transferí", 1ª pessoa do pretérito) agora são reconhecidas pelas
   * duas funções. Continuam bloqueadas/escaladas por completo (sem
   * reconhecimento automático) porque nenhuma delas menciona comprovante —
   * só o item 6 da matriz (comprovante mencionado) ganhou o reconhecimento
   * neutro.
   */
  describe('Lacuna corrigida — conjugações de "transferir" fora do infinitivo/substantivo agora são detectadas por ambas as funções', () => {
    it.each(['Ya transferí', 'Transferí ayer', 'Ya te transferí'])(
      'gate pré-envio bloqueia "%s" por completo (sem comprovante mencionado, sem reconhecimento automático)',
      async (customerMessage) => {
        const verdict = await reviewAutoReplyBeforeSend({ customerMessage, draftBubbles: ['Perfecto, gracias.'] }, {});
        expect(verdict.approved).toBe(false);
        expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
      },
    );

    it.each(['Ya transferí', 'Transferí ayer', 'Ya te transferí'])(
      'fluxo de escalonamento agora também reconhece "%s" como pagamento',
      (text) => {
        expect(isPaymentRelated(text)).toBe(true);
      },
    );
  });

  /**
   * Divergência do TASK-0440 corrigida: "pagué"/"pagué ayer" (espanhol, sem
   * o "i" final de "paguei" em português) agora é reconhecido pelas duas
   * funções — `pagu[eé]i` virou `pagu[eé]i?` em `isPaymentRelated`.
   */
  describe('Divergência corrigida — "Pagué"/"Pagué ayer" (espanhol) agora bloqueia no gate E escala', () => {
    it.each(['Pagué', 'Pagué ayer', 'Ya pagué'])('o gate pré-envio bloqueia "%s"', async (customerMessage) => {
      const verdict = await reviewAutoReplyBeforeSend({ customerMessage, draftBubbles: ['Perfecto, gracias.'] }, {});
      expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it.each(['Pagué', 'Pagué ayer', 'Ya pagué'])('e o fluxo de escalonamento agora também reconhece "%s"', (text) => {
      expect(isPaymentRelated(text)).toBe(true);
    });
  });

  describe('Confirmação: "¿Puedo pagar en efectivo?" continua sem ser tratado como sensível por nenhuma das duas funções', () => {
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

  describe('Confirmação: "¿Cuánto es la seña?" (pergunta de política, item 4 da matriz — valor pode ser informado automaticamente)', () => {
    it('o gate pré-envio não bloqueia mais por conter "seña" sozinho', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        { customerMessage: '¿Cuánto es la seña?', draftBubbles: ['La seña es de Gs 50.000.'] },
        {},
      );
      expect(verdict.reason).not.toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });

    it('mas uma confirmação real de pagamento da seña continua bloqueando (contém "pagué", não é só a palavra "seña")', async () => {
      const verdict = await reviewAutoReplyBeforeSend(
        { customerMessage: 'Ya pagué la seña, cuándo confirman?', draftBubbles: ['Já vou verificar com a equipe.'] },
        {},
      );
      expect(verdict.approved).toBe(false);
      expect(verdict.reason).toBe(PAYMENT_SENSITIVE_ESCALATION_REASON);
    });
  });
});
