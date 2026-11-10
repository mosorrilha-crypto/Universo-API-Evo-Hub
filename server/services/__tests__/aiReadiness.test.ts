import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
const mocks = vi.hoisted(() => ({ conversation: vi.fn(), knowledge: vi.fn(), channel: vi.fn(), generating: vi.fn() }));
vi.mock('../conversationStore', () => ({ getConversation: (...args: unknown[]) => mocks.conversation(...args) }));
vi.mock('../knowledgeBaseStore', () => ({ getRuntimeKnowledgeBase: (...args: unknown[]) => mocks.knowledge(...args) }));
vi.mock('../tenantResolver', () => ({ resolveCredentialsForConversation: (...args: unknown[]) => mocks.channel(...args) }));
vi.mock('../generatingLock', () => ({ isGenerating: (...args: unknown[]) => mocks.generating(...args) }));
import { getAiReadiness } from '../aiReadiness';

const now = Date.parse('2026-11-10T18:00:00Z');
const deps = { aiConfigured: true, sharedMeta: {}, sharedEvo: {} };
let db: ReturnType<typeof createFakeSupabase>;
let conversation: any;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  db = createFakeSupabase({
    agent_status: [{ tenant_id: 'a', status: 'active', ads_only: false, leads_only: false }],
    conversations: [{ id: 'conv-a', tenant_id: 'a', phone: '123' }],
    messages: [{ id: 'in', tenant_id: 'a', conversation_id: 'conv-a', sender: 'lead', created_at: new Date(now - 60000).toISOString() }],
  });
  initDb(db);
  conversation = { phone: '123', messages: [{ sender: 'lead', timestamp: new Date(now - 60000).toISOString() }] };
  mocks.conversation.mockReset().mockResolvedValue(conversation);
  mocks.knowledge.mockReset().mockResolvedValue({ knowledgeBase: {} });
  mocks.channel.mockReset().mockResolvedValue({ provider: 'evolution', evolutionApiUrl: 'https://evo.example', evolutionApiKey: 'private-key', evolutionInstanceName: 'instance-a' });
  mocks.generating.mockReset().mockReturnValue(false);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ instance: { state: 'open' } })));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const check = () => getAiReadiness('a', '123', deps);

describe('prontidão real da IA por lead', () => {
  it('fica pronta somente com regras, IA, base, conexão e recepção recente confirmadas', async () => {
    expect(await check()).toMatchObject({ state: 'ready', reason: 'ready', validUntil: new Date(now + 45000).toISOString() });
    expect(fetch).toHaveBeenCalledWith('https://evo.example/instance/connectionState/instance-a', expect.objectContaining({ redirect: 'error' }));
    expect(JSON.stringify(await check())).not.toContain('private-key');
  });
  it('bloqueio global prevalece sobre contato liberado e geração', async () => {
    db.__tables.agent_status[0].status = 'paused'; mocks.generating.mockReturnValue(true);
    expect(await check()).toMatchObject({ state: 'blocked', reason: 'agent_paused' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('respeita o horário restrito real do Paraguai', async () => {
    db.__tables.agent_status[0].status = 'restricted';
    expect((await check()).reason).toBe('restricted_hours');
    vi.setSystemTime(Date.parse('2026-11-11T00:00:00Z'));
    expect((await check()).reason).not.toBe('restricted_hours');
  });
  it('bloqueio do contato impede selo pronto', async () => {
    conversation.aiBlockedAt = new Date(now).toISOString();
    expect((await check()).reason).toBe('contact_blocked');
  });
  it('conversa iniciada manualmente aguarda qualificação', async () => {
    conversation.messages = [{ sender: 'agent', sentBy: 'operator', timestamp: new Date(now - 600000).toISOString() }];
    expect((await check()).reason).toBe('operator_started');
  });
  it('respeita a pausa humana e a devolução explícita', async () => {
    conversation.messages.push({ sender: 'agent', sentBy: 'operator', timestamp: new Date(now - 60000).toISOString() });
    expect((await check()).reason).toBe('operator_active');
    conversation.operatorAiReleaseAt = new Date(now).toISOString();
    expect((await check()).state).toBe('ready');
  });
  it('mostra geração baseada na trava real do servidor', async () => {
    mocks.generating.mockReturnValue(true);
    expect(await check()).toMatchObject({ state: 'busy', reason: 'generating' });
    expect(mocks.generating).toHaveBeenCalledWith('a', '123');
  });
  it('não promete resposta quando faltam IA ou base publicada', async () => {
    expect((await getAiReadiness('a', '123', { ...deps, aiConfigured: false })).reason).toBe('ai_unavailable');
    mocks.knowledge.mockResolvedValue({ knowledgeBase: null });
    expect((await check()).reason).toBe('knowledge_unavailable');
  });
  it('filtro de anúncio pendente é condicional e não grava qualificação', async () => {
    db.__tables.agent_status[0].ads_only = true;
    expect(await check()).toMatchObject({ state: 'conditional', reason: 'ads_only' });
    expect(db.__tables.conversations[0]).not.toHaveProperty('ad_greeting_matched_at');
    conversation.adGreetingMatchedAt = new Date(now).toISOString();
    expect((await check()).state).toBe('ready');
  });
  it('contato com anúncio real é elegível', async () => {
    db.__tables.agent_status[0].ads_only = true; db.__tables.conversations[0].ctwa_clid = 'ad';
    expect((await check()).state).toBe('ready');
  });
  it('filtro semântico permanece condicional', async () => {
    db.__tables.agent_status[0].leads_only = true;
    expect(await check()).toMatchObject({ state: 'conditional', reason: 'leads_only' });
  });
  it.each(['close', 'connecting'])('canal %s impede verde', async state => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ instance: { state } })));
    expect((await check()).reason).toBe('channel_disconnected');
  });
  it.each([401, 502])('falha HTTP %s é estado incerto', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status }));
    expect((await check()).state).toBe('unknown');
  });
  it('timeout e falha de leitura não viram pronto', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'));
    expect((await check()).state).toBe('unknown');
    mocks.conversation.mockRejectedValue(new Error('db'));
    expect((await check()).state).toBe('unknown');
  });
  it('socket aberto sem recepção recente não comprova prontidão', async () => {
    db.__tables.messages[0].created_at = new Date(now - 16 * 60000).toISOString();
    expect(await check()).toMatchObject({ state: 'unknown', reason: 'receive_unverified' });
  });
  it('mensagens de outro tenant ou contato não validam este lead', async () => {
    db.__tables.messages = [
      { tenant_id: 'b', conversation_id: 'conv-a', sender: 'lead', created_at: new Date(now).toISOString() },
      { tenant_id: 'a', conversation_id: 'conv-other', sender: 'lead', created_at: new Date(now).toISOString() },
    ];
    expect((await check()).reason).toBe('receive_unverified');
    expect(mocks.conversation).toHaveBeenCalledWith('a', '123');
    expect(mocks.channel).toHaveBeenCalledWith('a', undefined, {}, {});
  });
});
