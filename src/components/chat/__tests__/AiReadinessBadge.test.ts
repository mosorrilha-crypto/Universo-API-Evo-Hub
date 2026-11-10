import { describe, expect, it } from 'vitest';
import { aiReadinessPresentation } from '../AiReadinessBadge';
const now = Date.parse('2026-11-10T18:00:00Z');
const ready = { state: 'ready' as const, reason: 'ready', checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 45000).toISOString() };
describe('selo de prontidão da IA', () => {
  it('só confirma atendimento com avaliação válida do servidor', () => {
    expect(aiReadinessPresentation(ready, true, now).label).toBe('IA no atendimento');
    expect(aiReadinessPresentation(undefined, true, now).state).toBe('unknown');
  });
  it('expira e não conserva verde durante falha de atualização', () => {
    expect(aiReadinessPresentation(ready, true, now + 45000).state).toBe('unknown');
  });
  it('separa demonstração de atendimento real', () => {
    expect(aiReadinessPresentation(ready, false, now).label).toBe('Demonstração');
  });
  it('não apresenta bloqueio/condição/incerteza como atendimento', () => {
    for (const state of ['blocked', 'conditional', 'unknown'] as const) {
      expect(aiReadinessPresentation({ ...ready, state, reason: 'leads_only' }, true, now).label).not.toBe('IA no atendimento');
    }
  });
  it('distingue geração real de prontidão e traduz espanhol', () => {
    expect(aiReadinessPresentation({ ...ready, state: 'busy', reason: 'generating' }, true, now).label).toBe('IA respondendo');
    expect(aiReadinessPresentation(ready, true, now, true).label).toBe('IA en atención');
  });
  it('recusa datas inválidas e validade prolongada', () => {
    expect(aiReadinessPresentation({ ...ready, validUntil: 'invalid' }, true, now).state).toBe('unknown');
    expect(aiReadinessPresentation({ ...ready, validUntil: new Date(now + 600000).toISOString() }, true, now).state).toBe('unknown');
  });
});
