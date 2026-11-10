import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../db', () => ({ getPlatformDb: () => db }));
vi.mock('../tokenCrypto', () => ({ decryptSecret: () => 'secret-test' }));
import { parseHistoryProbeRequest, runEvolutionHistoryProbe } from '../evolutionHistoryProbe';
const now = Date.now();
const request = { tenantId: '8a786c2a-aa8c-4c2a-bc12-d50058c598ce', from: '2026-11-10T03:00:00Z', to: '2026-11-11T03:00:00Z', expiresAt: new Date(now + 1800000).toISOString() };
beforeEach(() => { vi.restoreAllMocks(); db.from.mockReset(); });
describe('consulta operacional de histórico', () => {
  it('desativada sem configuração', async () => { await runEvolutionHistoryProbe(''); expect(db.from).not.toHaveBeenCalled(); });
  it.each([
    { tenantId: 'invalid' }, { expiresAt: new Date(now - 1).toISOString() },
    { expiresAt: new Date(now + 7200000).toISOString() }, { from: 'invalid' },
    { to: request.from }, { to: '2026-11-12T03:00:00Z' },
  ])('recusa configuração inválida %j', (patch) => {
    expect(() => parseHistoryProbeRequest(JSON.stringify({ ...request, ...patch }), now)).toThrow();
  });
  it('consulta dia exato sem expor segredo/conteúdo nem escrever no banco', async () => {
    const credentialQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { instance_name: 'monique', api_url: 'https://evolution.example', api_key: 'encrypted' } }) };
    const messageQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: 'a' }] }) };
    db.from.mockReturnValueOnce(credentialQuery).mockReturnValueOnce(messageQuery);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messages: { total: 2, records: [
      { key: { id: 'a' }, messageTimestamp: Date.parse(request.from) / 1000, message: { conversation: 'private' } },
      { key: { id: 'b' }, messageTimestamp: Date.parse(request.to) / 1000 - 1 },
    ] } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runEvolutionHistoryProbe(JSON.stringify(request));
    const options = fetchMock.mock.calls[0][1]!;
    expect(JSON.parse(options.body as string).where.messageTimestamp).toEqual({ gte: request.from, lte: '2026-11-11T02:59:59.999Z' });
    expect(options.redirect).toBe('error');
    expect(messageQuery.eq).toHaveBeenCalledWith('tenant_id', request.tenantId);
    expect(JSON.parse(log.mock.calls[0][1] as string).sampledMissing).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-test|private|encrypted/);
    expect(db.from.mock.calls.map(c => c[0])).toEqual(['tenant_evolution_credentials', 'messages']);
  });
  it('não registra resposta do provedor no erro', async () => {
    db.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { instance_name: 'monique', api_url: 'https://evolution.example', api_key: 'encrypted' } }) }) }) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret body', { status: 401 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runEvolutionHistoryProbe(JSON.stringify(request));
    expect(JSON.stringify(log.mock.calls)).toContain('Evolution HTTP 401');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret body');
  });
});

describe('retomada restrita da conexão', () => {
  const restartRequest = { ...request, action: 'restart', requestId: '6d7f72ef-1165-47e7-8f38-024d53c38a58' };
  function credential() {
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { instance_name: 'monique', api_url: 'https://evolution.example', api_key: 'encrypted' } }) }) }) };
  }
  it('recusa ação desconhecida e restart sem identificador', () => {
    expect(() => parseHistoryProbeRequest(JSON.stringify({ ...request, action: 'delete' }), now)).toThrow();
    expect(() => parseHistoryProbeRequest(JSON.stringify({ ...request, action: 'restart' }), now)).toThrow();
  });
  it('reinicia somente a instância cadastrada, uma vez e sem logout/delete', async () => {
    db.from.mockReturnValueOnce(credential()).mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: { total: 0, records: [] } })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runEvolutionHistoryProbe(JSON.stringify(restartRequest));
    expect(call.mock.calls.map(([url]) => url)).toEqual(['https://evolution.example/instance/restart/monique', 'https://evolution.example/chat/findMessages/monique']);
    expect(call.mock.calls[0][1]?.method).toBe('POST');
  });
  it('não repete restart reivindicado em outro processo', async () => {
    db.from.mockReturnValueOnce(credential()).mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: { code: '23505' } }) });
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messages: { total: 0, records: [] } })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runEvolutionHistoryProbe(JSON.stringify(restartRequest));
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0][0])).toContain('/chat/findMessages/');
  });
  it('não reinicia quando a reivindicação falha', async () => {
    db.from.mockReturnValueOnce(credential()).mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: { code: '500' } }) });
    const call = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runEvolutionHistoryProbe(JSON.stringify(restartRequest));
    expect(call).not.toHaveBeenCalled();
  });
});

describe('ajuste restrito de grupos', () => {
  const adjust = { ...request, action: 'ignore_groups', requestId: 'a742911e-aaab-4c9f-b958-933d7dba244b' };
  function prepare(error: any = null) {
    db.from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { instance_name: 'daniel', api_url: 'https://evolution.example', api_key: 'encrypted' } }) }) }) })
      .mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error }) });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  }
  it('preserva outros ajustes, altera somente grupos e verifica a aplicação', async () => {
    prepare();
    const current = { groupsIgnore: false, rejectCall: true, msgCall: 'ocupado', readMessages: false, readStatus: true, alwaysOnline: false, syncFullHistory: true, wavoipToken: 'private-voip' };
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(current)))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...current, groupsIgnore: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: { total: 0, records: [] } })));
    await runEvolutionHistoryProbe(JSON.stringify(adjust));
    expect(String(call.mock.calls[1][0])).toBe('https://evolution.example/settings/set/daniel');
    expect(JSON.parse(call.mock.calls[1][1]?.body as string)).toEqual({ ...current, groupsIgnore: true });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private-voip');
    expect(call).toHaveBeenCalledTimes(4);
  });
  it('omite strings opcionais null aceitas pelo banco mas recusadas pelo schema HTTP', async () => {
    prepare();
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ groupsIgnore: false, msgCall: null, wavoipToken: null })))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ groupsIgnore: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: { total: 0, records: [] } })));
    await runEvolutionHistoryProbe(JSON.stringify(adjust));
    expect(JSON.parse(call.mock.calls[1][1]?.body as string)).toEqual({ groupsIgnore: true });
  });
  it('não altera configurações se a leitura falha', async () => {
    prepare();
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await runEvolutionHistoryProbe(JSON.stringify(adjust));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('não altera configurações em falha ou duplicata da reivindicação', async () => {
    prepare({ code: '500' });
    const call = vi.spyOn(globalThis, 'fetch');
    await runEvolutionHistoryProbe(JSON.stringify(adjust));
    expect(call).not.toHaveBeenCalled();
  });
});
