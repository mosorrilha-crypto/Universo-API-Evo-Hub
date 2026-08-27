/**
 * Achado real (26/08/2026): quando o operador deixa uma orientação
 * ("Orientar IA") e a IA monta uma mensagem de retomada com base nela, o
 * revisor pré-envio pode bloquear esse rascunho — e antes disso, o
 * bloqueio só virava um toast passageiro no painel, sem nenhum jeito de
 * revisar/editar/enviar o texto que a IA tentou mandar. Corrigido
 * reaproveitando o mesmo mecanismo do bloqueio normal (logEscalation com
 * o mesmo sourceKey do webhooks.ts), pra que o card ganhe um blockedDraft
 * revisável em "Aprovar e enviar" em vez de sumir.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { logEscalation, getEscalation, reviewerEscalationSourceKey } from '../escalationStore';

vi.mock('../conversationStore', () => ({
  getConversation: vi.fn().mockResolvedValue({ messages: [] }),
  recordOutgoingMessage: vi.fn().mockResolvedValue(undefined),
  inferCountryFromPhone: vi.fn().mockReturnValue('Paraguai'),
}));
vi.mock('../metaSend', () => ({
  sendWhatsAppTextMessage: vi.fn().mockResolvedValue(undefined),
  sendWhatsAppTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../replySafetyGate', () => ({
  reviewAutoReplyBeforeSend: vi.fn(),
}));

import { recordOutgoingMessage } from '../conversationStore';
import { sendWhatsAppTextMessage } from '../metaSend';
import { reviewAutoReplyBeforeSend } from '../replySafetyGate';
import { sendOperatorGuidedFollowUp } from '../operatorFollowUpService';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PHONE = '556798038466';

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.clearAllMocks();
});

async function seedEscalationWithinWindow() {
  return logEscalation(
    TENANT_A,
    PHONE,
    'Lucas',
    'Revisor pré-envio bloqueou a resposta automática: motivo original',
    'Eu só posso depois das 18:00',
    'general',
    { sourceKey: reviewerEscalationSourceKey(PHONE), priority: 'high', blockedDraft: 'Infelizmente não temos horários disponíveis depois das 18:00.' }
  );
}

describe('sendOperatorGuidedFollowUp — retomada guiada bloqueada pelo revisor', () => {
  it('quando o revisor bloqueia o rascunho de retomada, atualiza o mesmo escalonamento com o novo blockedDraft (não fica só num toast perdido)', async () => {
    const seeded = await seedEscalationWithinWindow();
    const withGuidance = await (await import('../escalationStore')).submitOperatorReply(TENANT_A, seeded.id, 'Podemos abrir uma exceção para esta cliente');
    expect(withGuidance).toBeTruthy();

    // Dentro da janela de 24h: getConversation mockado retorna uma mensagem recente do lead.
    const conversationStoreMock = await import('../conversationStore');
    (conversationStoreMock.getConversation as any).mockResolvedValue({
      messages: [{ sender: 'lead', text: 'Eu só posso depois das 18:00', timestamp: new Date().toISOString() }],
    });

    (reviewAutoReplyBeforeSend as any).mockResolvedValue({ approved: false, source: 'gemini-reviewer', severity: 'medium', reason: 'Exceção de horário não confirmada na base.' });

    const ai = { models: { generateContent: vi.fn().mockResolvedValue({ text: '¡Buenísimo! Podemos hacer una excepción para vos, ¿te sirve a las 18:30?' }) } } as any;

    const outcome = await sendOperatorGuidedFollowUp(TENANT_A, withGuidance!, {
      ai,
      metaAccessToken: 'token',
      metaPhoneNumberId: 'phone-id',
      tenantName: 'Monique',
    });

    expect(outcome.sent).toBe(false);
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(recordOutgoingMessage).not.toHaveBeenCalled();

    const updated = await getEscalation(TENANT_A, seeded.id);
    expect(updated?.blockedDraft).toContain('excepción para vos');
    expect(updated?.reason).toContain('retomada guiada pela orientação do operador');
    expect(updated?.resolved).toBe(false);
  });

  it('quando o revisor aprova, envia normalmente e marca a orientação como consumida', async () => {
    const seeded = await seedEscalationWithinWindow();
    const withGuidance = await (await import('../escalationStore')).submitOperatorReply(TENANT_A, seeded.id, 'Podemos abrir uma exceção para esta cliente');

    const conversationStoreMock = await import('../conversationStore');
    (conversationStoreMock.getConversation as any).mockResolvedValue({
      messages: [{ sender: 'lead', text: 'Eu só posso depois das 18:00', timestamp: new Date().toISOString() }],
    });
    (reviewAutoReplyBeforeSend as any).mockResolvedValue({ approved: true, source: 'gemini-reviewer', severity: 'low', reason: 'ok' });

    const ai = { models: { generateContent: vi.fn().mockResolvedValue({ text: '¡Buenísimo! Podemos hacer una excepción para vos.' }) } } as any;

    const outcome = await sendOperatorGuidedFollowUp(TENANT_A, withGuidance!, {
      ai,
      metaAccessToken: 'token',
      metaPhoneNumberId: 'phone-id',
      tenantName: 'Monique',
    });

    expect(outcome.sent).toBe(true);
    expect(sendWhatsAppTextMessage).toHaveBeenCalled();
    const updated = await getEscalation(TENANT_A, seeded.id);
    expect(updated?.operatorReplyConsumedAt).toBeTruthy();
    expect(updated?.resolved).toBe(true);
  });
});
