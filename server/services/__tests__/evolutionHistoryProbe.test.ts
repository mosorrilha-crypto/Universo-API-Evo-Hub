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
