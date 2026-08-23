import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { freshnessFor, getLatestConversationAnalysis, saveConversationAnalysis } from '../conversationAnalysisStore';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PHONE = '595981111111';
const KB = { businessName: 'Teste' };

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('conversationAnalysisStore', () => {
  it('persiste e recupera a última Ficha por conversa', async () => {
    const stored = await saveConversationAnalysis(
      TENANT_ID,
      PHONE,
      [{ sender: 'lead', text: 'Qual é o valor?' }],
      KB,
      { leadStage: 'contato', dealProbability: 40 },
      'groq',
      { model: 'groq' },
    );

    const latest = await getLatestConversationAnalysis(TENANT_ID, PHONE);
    expect(latest?.id).toBe(stored.id);
    expect(latest?.analysis).toMatchObject({ leadStage: 'contato' });
    expect(freshnessFor(1, latest).isFresh).toBe(true);
  });

  it('substitui a versão ativa somente quando o histórico muda e informa o delta de mensagens', async () => {
    await saveConversationAnalysis(TENANT_ID, PHONE, [{ sender: 'lead', text: 'Olá' }], KB, { leadStage: 'novo' }, 'gemini');
    const stored = await saveConversationAnalysis(
      TENANT_ID,
      PHONE,
      [{ sender: 'lead', text: 'Olá' }, { sender: 'lead', text: 'Quero agendar' }],
      KB,
      { leadStage: 'proposta' },
      'gemini',
    );

    const latest = await getLatestConversationAnalysis(TENANT_ID, PHONE);
    expect(latest?.id).toBe(stored.id);
    expect(latest?.analysis).toMatchObject({ leadStage: 'proposta' });
    expect(freshnessFor(4, latest)).toEqual({ isFresh: false, newMessages: 2 });
  });
});
