/**
 * TASK-0375 — "Testar roteiro manual" (chat interativo turno a turno na
 * Central de Qualidade). Mocka generateAutoReplyForText/getRuntimeKnowledgeBase
 * (dependências pesadas, já cobertas em seus próprios testes) pra testar só
 * a responsabilidade da ROTA: validação de entrada, resolução de KB/segmento,
 * telefone fictício, e que o calendário passado adiante é o REAL (nunca
 * omitido) — mesmo padrão de mock de módulo já usado em
 * qualityAuditEvalRuns.test.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
vi.mock('../../services/autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getRuntimeKnowledgeBase = vi.fn();
vi.mock('../../services/knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseStore')>();
  return { ...actual, getRuntimeKnowledgeBase };
});

const getTenantSegment = vi.fn();
vi.mock('../../services/tenantProfileStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tenantProfileStore')>();
  return { ...actual, getTenantSegment };
});

const { createQualityAuditRouter } = await import('../qualityAudit');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
let server: Server;
let baseUrl: string;
let fakeAi: any = {};

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-a', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createQualityAuditRouter({
    authenticateToken: fakeAuthenticateToken as any,
    isQualityModuleEnabled: async () => true,
    getAi: () => fakeAi,
    groqApiKey: undefined,
    googleClientId: 'client-id',
    googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://universo.example.com/oauth/callback',
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  fakeAi = {};
  getRuntimeKnowledgeBase.mockResolvedValue({ source: 'published_documents', knowledgeBase: { products: [] } });
  getTenantSegment.mockResolvedValue('generic');
  generateAutoReplyForText.mockResolvedValue({ bubbles: ['Hola! ¿En qué puedo ayudarte?'], agent: 'triagem', needsHumanConfirmation: false });
});

describe('POST /api/quality-audit/manual-test', () => {
  it('503 quando o Gemini não está configurado', async () => {
    fakeAi = null;
    const response = await fetch(`${baseUrl}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(response.status).toBe(503);
    expect(generateAutoReplyForText).not.toHaveBeenCalled();
  });

  it('400 quando text está vazio ou ausente', async () => {
    const response = await fetch(`${baseUrl}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(response.status).toBe(400);
    expect(generateAutoReplyForText).not.toHaveBeenCalled();
  });

  it('chama o pipeline real com telefone fictício e o calendário REAL do app (nunca omitido)', async () => {
    const response = await fetch(`${baseUrl}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Cuánto cuesta el combo?', history: [{ sender: 'lead', text: 'Hola' }, { sender: 'agent', text: 'Hola! ¿En qué puedo ayudarte?' }] }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.bubbles).toEqual(['Hola! ¿En qué puedo ayudarte?']);
    expect(data.agent).toBe('triagem');

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    const args = generateAutoReplyForText.mock.calls[0];
    expect(args[0]).toBe(TENANT_A); // tenantId
    expect(args[2]).toBe('Cuánto cuesta el combo?'); // text
    expect(args[5]).toEqual([{ sender: 'lead', text: 'Hola' }, { sender: 'agent', text: 'Hola! ¿En qué puedo ayudarte?' }]); // history
    expect(typeof args[6]).toBe('string'); // phone fictício
    expect(args[6]).toMatch(/^test-/);
    // calendarConfig (índice 7) precisa ser o REAL, nunca undefined — é o que torna o teste de agendamento útil de verdade.
    expect(args[7]).toEqual({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://universo.example.com/oauth/callback' });
  });

  it('502 quando o agente não consegue gerar resposta (Gemini indisponível)', async () => {
    generateAutoReplyForText.mockResolvedValueOnce(null);
    const response = await fetch(`${baseUrl}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(response.status).toBe(502);
  });

  it('503 quando a Base de Conhecimento está indisponível pro tenant', async () => {
    getRuntimeKnowledgeBase.mockResolvedValueOnce({ source: 'unavailable' });
    const response = await fetch(`${baseUrl}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(response.status).toBe(503);
    expect(generateAutoReplyForText).not.toHaveBeenCalled();
  });

  it('403 pra operator/manager — só admin+ consegue testar', async () => {
    const app = express();
    app.use(express.json());
    app.use(createQualityAuditRouter({
      authenticateToken: (req: any, _res: any, next: any) => { req.user = { id: 'op-1', tenantId: TENANT_A, role: 'operator' }; next(); },
      isQualityModuleEnabled: async () => true,
      getAi: () => fakeAi,
    }));
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', resolve));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const response = await fetch(`${url}/api/quality-audit/manual-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(response.status).toBe(403);
    s.close();
  });
});
