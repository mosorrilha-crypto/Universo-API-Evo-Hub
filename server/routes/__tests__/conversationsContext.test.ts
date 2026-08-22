import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const PHONE = '595981111111';

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-a', tenantId: TENANT_A, role: 'operator' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter({
    authenticateToken: fakeAuthenticateToken as any,
    jwtSecret: 'test-secret',
    metaAccessToken: 'token',
    metaPhoneNumberId: 'phone-id',
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  initDb(createFakeSupabase({
    contact_agent_memory: [
      {
        tenant_id: TENANT_A,
        phone: PHONE,
        preferred_language: 'es-PY',
        preferred_name: 'Ana',
        current_intent: 'agendamento',
        service_interest: 'pestañas/extensiones',
        objections: ['Quer entender a duração.'],
        facts_confirmed: { preferredChannel: 'whatsapp' },
        open_loops: [{ kind: 'agenda', summary: 'Aguardando confirmação humana.', status: 'awaiting_human' }],
        next_best_action: 'Aguardar confirmação humana.',
        conversation_summary: 'Interesse em extensões.',
        updated_by: 'system',
        created_at: '2026-08-22T10:00:00.000Z',
        updated_at: '2026-08-22T10:05:00.000Z',
      },
      {
        tenant_id: TENANT_B,
        phone: PHONE,
        preferred_language: 'pt-BR',
        preferred_name: 'Outro tenant',
        current_intent: 'faq',
        service_interest: 'dado isolado',
        objections: [],
        facts_confirmed: {},
        open_loops: [],
        next_best_action: 'Não vazar.',
        conversation_summary: 'Não vazar.',
        updated_by: 'system',
        created_at: '2026-08-22T10:00:00.000Z',
        updated_at: '2026-08-22T10:05:00.000Z',
      },
    ],
    agent_turn_traces: [
      {
        id: 'trace-a',
        tenant_id: TENANT_A,
        phone: PHONE,
        message_id: 'message-a',
        router_decision: 'agendamento',
        router_confidence: null,
        reasoning_summary: 'Roteado para agendamento; gate humano ativo.',
        context_pack_version: 'contact-context-v1',
        selected_facts: { hasActiveAppointment: true, paymentStatus: 'pending_verification' },
        tool_summaries: ['Disponibilidade consultada.'],
        needs_human_confirmation: true,
        escalation_id: 'esc-a',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        latency_ms: 100,
        estimated_cost_usd: null,
        outcome: 'human_confirmation_required',
        created_at: '2026-08-22T10:05:00.000Z',
      },
      {
        id: 'trace-b',
        tenant_id: TENANT_B,
        phone: PHONE,
        message_id: 'message-b',
        router_decision: 'faq',
        router_confidence: null,
        reasoning_summary: 'Dado de outro tenant.',
        context_pack_version: 'contact-context-v1',
        selected_facts: {},
        tool_summaries: [],
        needs_human_confirmation: false,
        escalation_id: null,
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        latency_ms: 100,
        estimated_cost_usd: null,
        outcome: 'reply_ready',
        created_at: '2026-08-22T10:06:00.000Z',
      },
    ],
  }));
});

describe('GET /api/conversations/:phone/context', () => {
  it('retorna memória e última decisão apenas do tenant autenticado', async () => {
    const response = await fetch(`${baseUrl}/api/conversations/${PHONE}/context`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.available).toBe(true);
    expect(body.memory).toMatchObject({
      preferredName: 'Ana',
      preferredLanguage: 'es-PY',
      currentIntent: 'agendamento',
      serviceInterest: 'pestañas/extensiones',
    });
    expect(body.memory).not.toHaveProperty('phone');
    expect(body.latestDecision).toMatchObject({
      routerDecision: 'agendamento',
      needsHumanConfirmation: true,
      outcome: 'human_confirmation_required',
    });
    expect(JSON.stringify(body)).not.toContain('Outro tenant');
    expect(JSON.stringify(body)).not.toContain('dado isolado');
  });

  it('responde com estado vazio, porém seguro, quando o contato ainda não tem memória ou trace', async () => {
    const response = await fetch(`${baseUrl}/api/conversations/595982222222/context`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ available: true, memory: null, latestDecision: null });
  });
});
