import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OTHER_TENANT_ID = 'tenant-b';
const PHONE = '595981111111';
const realFetch = global.fetch;

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

const fakeAi = {
  models: {
    generateContent: vi.fn(async (request: any) => ({
      text: typeof request?.contents === 'string' && request.contents.includes('assistente de correção')
        ? JSON.stringify({ reply: '¡Claro! ¿Qué servicio te gustaría consultar?' })
        : JSON.stringify({ approved: true, severity: 'low', reason: 'Resposta segura.' }),
    })),
  },
};

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter({
    authenticateToken: fakeAuthenticateToken as any,
    jwtSecret: 'test-secret',
    getAi: () => fakeAi as any,
  }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

afterEach(() => {
  vi.unstubAllGlobals();
  global.fetch = realFetch;
  fakeAi.models.generateContent.mockClear();
});

function seed(kind: 'general' | 'payment_proof' = 'general') {
  const now = new Date().toISOString();
  supabase = createFakeSupabase({
    conversations: [
      {
        id: 'conv-a',
        tenant_id: TENANT_ID,
        phone: PHONE,
        name: 'Cliente Teste',
        updated_at: now,
        last_read_at: '1970-01-01T00:00:00.000Z',
        geo_restriction: null,
        archived_at: null,
        pinned_at: null,
        muted: false,
        manually_unread: false,
        ad_headline: null,
        ai_blocked_at: null,
        ad_greeting_matched_at: null,
        messages: [],
      },
    ],
    messages: [
      {
        id: 'msg-a',
        tenant_id: TENANT_ID,
        conversation_id: 'conv-a',
        sender: 'lead',
        type: 'text',
        text: 'Hola, ¿cuánto dura el servicio?',
        created_at: now,
        reply_to_message_id: null,
        forwarded_from_message_id: null,
        reactions: null,
        sent_by: null,
      },
    ],
    escalations: [
      {
        id: 'esc-a',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'A resposta tentou conduzir para agenda após pergunta informativa. Rascunho bloqueado: ¿Agendamos tu turno?',
        last_message: 'Hola, ¿cuánto dura el servicio?',
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind,
      },
      {
        id: 'esc-b',
        tenant_id: OTHER_TENANT_ID,
        phone: '595982222222',
        contact_name: 'Outro Tenant',
        reason: 'Caso de outro tenant',
        last_message: 'Olá',
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
    ],
    knowledge_base: [
      {
        tenant_id: TENANT_ID,
        data: {
          companyName: 'Studio Seguro',
          toneOfVoice: 'amável',
          pricingAndPolicies: 'SEGREDO_INTERNO_DE_PAGAMENTO',
          businessRules: ['REGRA_INTERNA_NAO_EXIBIR'],
          documents: [{ fileName: 'interno.txt', extractedText: 'DADO_INTERNO_DOCUMENTO' }],
          products: [{ name: 'Lifting de pestañas', active: true, category: 'Pestañas', price: 100, description: 'Serviço comercial público', aliases: ['lifting'], variants: [] }],
          faqs: [{ question: 'Quanto dura?', answer: 'A duração depende do serviço.' }],
        },
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/escalations/:id/reply-suggestion', () => {
  it('gera e persiste uma proposta sem criar mensagem de saída', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/reply-suggestion`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.suggestion).toEqual({ text: '¡Claro! ¿Qué servicio te gustaría consultar?', source: 'gemini-suggestion' });
    expect(data.escalation.suggestedReplyStatus).toBe('generated');
    expect(data.escalation.suggestedReplySource).toBe('gemini-suggestion');
    expect(supabase.__tables.messages).toHaveLength(1);
    expect(supabase.__tables.quality_audit_events[0].event_type).toBe('reply_suggestion_generated');
    expect(supabase.__tables.quality_audit_events[0].payload).not.toHaveProperty('suggestion');

    const prompt = fakeAi.models.generateContent.mock.calls[0][0].contents as string;
    expect(prompt).toContain('Lifting de pestañas');
    expect(prompt).not.toContain('SEGREDO_INTERNO_DE_PAGAMENTO');
    expect(prompt).not.toContain('DADO_INTERNO_DOCUMENTO');
    expect(prompt).not.toContain('REGRA_INTERNA_NAO_EXIBIR');
  });

  it('recusa pagamento e não chama o gerador', async () => {
    seed('payment_proof');
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/reply-suggestion`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(fakeAi.models.generateContent).not.toHaveBeenCalled();
    expect(supabase.__tables.messages).toHaveLength(1);
  });

  it('não permite usar o ID de escalonamento de outro tenant', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-b/reply-suggestion`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(fakeAi.models.generateContent).not.toHaveBeenCalled();
  });
});

describe('POST /api/escalations/:id/reply-suggestion-feedback', () => {
  it('salva edição e registra somente metadados da ação', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/reply-suggestion-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'edited', suggestion: 'Texto revisado pelo operador.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation.suggestedReply).toBe('Texto revisado pelo operador.');
    expect(data.escalation.suggestedReplyStatus).toBe('edited');
    expect(supabase.__tables.quality_audit_events[0].event_type).toBe('reply_suggestion_edited');
    expect(supabase.__tables.quality_audit_events[0].payload).toEqual({ suggestionLength: 29 });
  });

  it('permite descartar sem apagar o motivo do bloqueio', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/reply-suggestion-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'discarded', suggestion: '' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation.suggestedReply).toBeUndefined();
    expect(data.escalation.suggestedReplyStatus).toBe('discarded');
    expect(supabase.__tables.escalations[0].reason).toContain('pergunta informativa');
  });
});
