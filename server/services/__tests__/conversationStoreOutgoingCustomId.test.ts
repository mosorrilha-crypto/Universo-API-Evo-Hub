/**
 * recordOutgoingMessage precisa aceitar um id pré-gerado (customId) — é o
 * que permite ao chamador (POST /send-media em conversations.ts) salvar a
 * mídia real (mediaImageStore) sob o MESMO id da mensagem gravada, pra
 * poder buscá-la de volta depois via GET /api/media/:messageId. Sem isso, o
 * áudio/imagem que o operador envia pelo painel nunca teria como ser
 * associado à mensagem gravada (achado real: "o áudio não fica na
 * conversa").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { recordOutgoingMessage } from '../conversationStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

let supabase: ReturnType<typeof createFakeSupabase>;

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

// fakeSupabase não emula o embedded select `messages(...)` que a query real
// do Supabase faz (só o Postgres real resolve esse join) — por isso os
// testes conferem a tabela crua (__tables.messages) em vez de
// conv.messages, igual outros testes de rota já fazem pra tabelas novas.
describe('recordOutgoingMessage — customId', () => {
  it('usa o customId fornecido em vez de gerar um novo', async () => {
    await recordOutgoingMessage(
      TENANT_A,
      '595981111111',
      { type: 'audio', text: '🎤 Áudio enviado', timestamp: '10:00' },
      'operator',
      undefined,
      undefined,
      'meu-id-fixo-123'
    );
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('meu-id-fixo-123');
  });

  it('sem customId, continua gerando um id automático (compatibilidade)', async () => {
    await recordOutgoingMessage(TENANT_A, '595981111111', { type: 'text', text: 'oi', timestamp: '10:00' }, 'operator');
    const rows = supabase.__tables.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^wa-/);
  });
});
