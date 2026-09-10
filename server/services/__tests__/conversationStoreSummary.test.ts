import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { listConversations, recordIncomingMessage, recordOutgoingMessage } from '../conversationStore';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
let fake: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  fake = createFakeSupabase();
  initDb(fake);
});

describe('resumo da lista de conversas', () => {
  it('transporta apenas a última mensagem e mantém a contagem de não lidas', async () => {
    await recordIncomingMessage(TENANT_ID, '595981111111', 'Cliente', {
      type: 'text',
      text: 'primeira mensagem',
      timestamp: '10:00',
    });
    const firstMessage = fake.__tables.messages[0];
    firstMessage.created_at = '2099-01-01T10:00:00.000Z';

    await recordIncomingMessage(TENANT_ID, '595981111111', 'Cliente', {
      type: 'text',
      text: 'última mensagem',
      timestamp: '10:01',
    });
    const secondMessage = fake.__tables.messages[1];
    secondMessage.created_at = '2099-01-01T10:01:00.000Z';

    const [conversation] = await listConversations(TENANT_ID);

    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.text).toBe('última mensagem');
    expect(conversation.lastMessageId).toBe(conversation.messages[0]?.id);
    expect(conversation.unreadCount).toBe(2);
  });

  // TASK-0243 — achado real de auditoria: a lista só sabia a última mensagem
  // da conversa (qualquer remetente), então não dava pra filtrar "dentro/fora
  // da janela de 24h" em lote sem abrir cada conversa — a janela é contada
  // desde a última mensagem do LEAD especificamente, quase sempre seguida de
  // uma resposta do agente/operador (que não deveria contar).
  it('lastLeadMessageAt reflete a última mensagem do LEAD, não a última mensagem da conversa', async () => {
    await recordIncomingMessage(TENANT_ID, '595982222222', 'Cliente', {
      type: 'text',
      text: 'oi',
      timestamp: '10:00',
    });
    const leadMessage = fake.__tables.messages[0];
    leadMessage.created_at = '2099-01-01T10:00:00.000Z';

    await recordOutgoingMessage(TENANT_ID, '595982222222', {
      type: 'text',
      text: 'resposta do operador',
      timestamp: '10:05',
    }, 'operator');
    const operatorMessage = fake.__tables.messages[1];
    operatorMessage.created_at = '2099-01-01T10:05:00.000Z';

    const [conversation] = await listConversations(TENANT_ID);

    expect(conversation.messages[0]?.text).toBe('resposta do operador');
    expect((conversation as any).lastLeadMessageAt).toBe('2099-01-01T10:00:00.000Z');
  });

  it('lastLeadMessageAt fica undefined quando o lead nunca escreveu', async () => {
    await recordOutgoingMessage(TENANT_ID, '595983333333', {
      type: 'text',
      text: 'mensagem de campanha',
      timestamp: '10:00',
    }, 'campaign');

    const [conversation] = await listConversations(TENANT_ID);

    expect((conversation as any).lastLeadMessageAt).toBeUndefined();
  });
});
