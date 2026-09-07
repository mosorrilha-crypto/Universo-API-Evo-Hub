/**
 * TASK-0330 — GET /api/tenant-prompt-audit: auditoria SOMENTE LEITURA do
 * prompt real mandado ao Gemini (Camada 1 fixa + Camada 3 Base de
 * Conhecimento, idênticas ao que o especialista real usa via
 * getPromptAuditView em autoReply.ts; Camada 4 real da conversa quando
 * `phone` é informado). Pedido direto (06/09/2026): depois de eliminar a
 * rota de salvar a KB inteira (TASK-0327), o dono do produto precisava de
 * outro jeito de conferir "quais informações estão chegando e como estão
 * chegando no agente".
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_A = 'tenant-a';
const PHONE = '595981111111';

let server: Server;
let baseUrl: string;
let currentRole = 'admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: currentRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

function completePublishedDocuments() {
  const now = new Date().toISOString();
  const documentTypes = ['business_profile', 'brand_voice', 'service_catalog', 'pricing_policies', 'opening_hours', 'faq', 'human_handoff_rules', 'media_assets'];
  return documentTypes.map((documentType) => ({
    id: `${TENANT_A}-${documentType}`,
    tenant_id: TENANT_A,
    document_type: documentType,
    version: 1,
    status: 'published',
    data: documentType === 'business_profile'
      ? { companyName: 'Estúdio Teste' }
      : documentType === 'service_catalog'
        ? { products: [{ name: 'Lash Lift', price: 'Gs 140.000' }] }
        : {},
    created_at: now,
    updated_at: now,
    published_at: now,
  }));
}

beforeEach(() => {
  currentRole = 'admin';
  const supabase = createFakeSupabase({
    knowledge_base_documents: completePublishedDocuments(),
    conversations: [
      {
        id: 'conv-a', tenant_id: TENANT_A, phone: PHONE, name: 'Cliente Teste', updated_at: new Date().toISOString(), last_read_at: '1970-01-01T00:00:00.000Z', geo_restriction: null, archived_at: null, pinned_at: null, muted: false, manually_unread: false, ad_headline: null, ai_blocked_at: null, ad_greeting_matched_at: null,
        // getConversation lê via select embutido ('*, messages(...)') — o
        // fake não faz join de verdade, então o array já vem pré-embutido
        // aqui, mesmo padrão de conversationsReplySuggestion.test.ts.
        messages: [
          { id: 'msg-1', sender: 'lead', type: 'text', text: '¿Cuánto cuesta el Lash Lift?', created_at: new Date().toISOString(), reply_to_message_id: null, forwarded_from_message_id: null, reactions: null, sent_by: null },
        ],
      },
    ],
  });
  initDb(supabase);
});

describe('GET /api/tenant-prompt-audit', () => {
  it('400 quando "agent" está ausente ou inválido', async () => {
    const missing = await fetch(`${baseUrl}/api/tenant-prompt-audit`);
    expect(missing.status).toBe(400);
    const invalid = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=inventado`);
    expect(invalid.status).toBe(400);
  });

  it('403 pra role abaixo de admin', async () => {
    currentRole = 'manager';
    const res = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=faq`);
    expect(res.status).toBe(403);
  });

  it('devolve o systemInstruction real (regras do agente + Base de Conhecimento publicada), sem telefone', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=faq`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agent).toBe('faq');
    expect(body.knowledgeBaseSource).toBe('published_documents');
    expect(body.systemInstruction).toContain('FAQ/ESPECIALISTA');
    expect(body.systemInstruction).toContain('Estúdio Teste');
    expect(body.systemInstruction).toContain('Lash Lift');
    expect(body.knowledgeBaseContext).toContain('Estúdio Teste');
    expect(body.conversationPreview).toBeUndefined();
    expect(Array.isArray(body.dynamicNotShown)).toBe(true);
    expect(body.dynamicNotShown.length).toBeGreaterThan(0);
  });

  it('com telefone de conversa real, inclui o histórico dela (Camada 4)', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=faq&phone=${PHONE}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.conversationPreview.contactName).toBe('Cliente Teste');
    expect(body.conversationPreview.historyText).toContain('¿Cuánto cuesta el Lash Lift?');
    expect(body.conversationPreview.contentsPreamble).toContain('Nome do cliente: Cliente Teste');
  });

  it('com telefone de conversa inexistente, não quebra e simplesmente não devolve conversationPreview', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=faq&phone=595989999999`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationPreview).toBeUndefined();
  });

  it('muda o texto de regras conforme o tipo de agente escolhido', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-audit?agent=agendamento`);
    const body = await res.json();
    expect(body.systemInstruction).toContain('AGENDAMENTO');
    expect(body.systemInstruction).not.toContain('FAQ/ESPECIALISTA');
  });
});
