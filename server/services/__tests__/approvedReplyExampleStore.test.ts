import { describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { saveApprovedReplyExample, listRecentApprovedReplyExamples, formatApprovedReplyExamplesForPrompt } from '../approvedReplyExampleStore';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('approvedReplyExampleStore', () => {
  it('grava e lista só os exemplos do próprio tenant, mais recentes primeiro', async () => {
    const supabase = createFakeSupabase({ tenant_approved_reply_examples: [] });
    initDb(supabase);

    await saveApprovedReplyExample(TENANT_A, {
      escalationId: 'esc-1',
      customerMessage: 'Quanto custa?',
      approvedReply: 'A partir de R$100.',
      reviewerReason: 'Bloqueado por preço não confirmado.',
      actorId: 'op-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveApprovedReplyExample(TENANT_A, {
      escalationId: 'esc-2',
      customerMessage: 'Vocês atendem sábado?',
      approvedReply: 'Sim, das 9h às 13h.',
      actorId: 'op-1',
    });
    await saveApprovedReplyExample(TENANT_B, {
      escalationId: 'esc-3',
      customerMessage: 'Outro tenant',
      approvedReply: 'Não deve aparecer pro tenant A.',
      actorId: 'op-2',
    });

    const examples = await listRecentApprovedReplyExamples(TENANT_A);
    expect(examples).toHaveLength(2);
    expect(examples[0].customerMessage).toBe('Vocês atendem sábado?');
    expect(examples.every((e) => e.approvedReply !== 'Não deve aparecer pro tenant A.')).toBe(true);
  });

  it('formata como texto vazio quando não há exemplo nenhum', () => {
    expect(formatApprovedReplyExamplesForPrompt([])).toBe('');
  });

  it('formata os exemplos em bullets com pergunta e resposta aprovada', () => {
    const text = formatApprovedReplyExamplesForPrompt([
      { id: '1', customerMessage: 'Quanto custa?', approvedReply: 'A partir de R$100.', createdAt: new Date().toISOString() },
    ]);
    expect(text).toContain('Quanto custa?');
    expect(text).toContain('A partir de R$100.');
    expect(text).toContain('aprovadas por um humano');
  });
});
