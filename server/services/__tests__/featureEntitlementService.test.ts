import { describe, expect, it } from 'vitest';
import { resolveEffectiveEntitlements } from '../featureEntitlementService';

const features = [
  { id: 'feature-agenda', key: 'booking.calendar', name: 'Agenda', domain: 'booking', kind: 'configurable' as const, status: 'active' as const },
  { id: 'feature-ia', key: 'ai.auto_reply', name: 'Agente de IA', domain: 'ai', kind: 'quota' as const, status: 'active' as const },
];

describe('resolveEffectiveEntitlements', () => {
  it('preserva compatibilidade positiva enquanto uma feature ainda não possui regra de plano', () => {
    const [agenda] = resolveEffectiveEntitlements({ features, rules: [], overrides: [], usage: [] });

    expect(agenda).toMatchObject({ key: 'booking.calendar', enabled: true, source: 'compatibility', limitValue: null, remaining: null });
  });

  it('calcula uso e restante a partir da regra do plano', () => {
    const [, ai] = resolveEffectiveEntitlements({
      features,
      rules: [{ feature_id: 'feature-ia', enabled: true, limit_value: 10, config: { model: 'standard' } }],
      overrides: [],
      usage: [{ feature_id: 'feature-ia', metric: 'messages', period_start: '2026-08-01', value: 7 }],
    });

    expect(ai).toMatchObject({ enabled: true, source: 'plan', limitValue: 10, usage: 7, remaining: 3, config: { model: 'standard' } });
  });

  it('faz o override ativo prevalecer sobre plano e mantém a origem auditável', () => {
    const [, ai] = resolveEffectiveEntitlements({
      features,
      rules: [{ feature_id: 'feature-ia', enabled: true, limit_value: 10, config: { model: 'standard' } }],
      overrides: [{ id: 'override-novo', feature_id: 'feature-ia', enabled: false, limit_value: 25, config: { model: 'premium' }, expires_at: '2026-09-01T00:00:00.000Z', revoked_at: null, reason: 'Piloto comercial' }],
      usage: [{ feature_id: 'feature-ia', metric: 'messages', period_start: '2026-08-01', value: 7 }],
      now: new Date('2026-08-26T12:00:00.000Z'),
    });

    expect(ai).toMatchObject({ enabled: false, source: 'override', limitValue: 25, remaining: 18, config: { model: 'premium' }, override: { id: 'override-novo', reason: 'Piloto comercial' } });
  });

  it('ignora override expirado e retorna à regra do plano sem intervenção manual', () => {
    const [, ai] = resolveEffectiveEntitlements({
      features,
      rules: [{ feature_id: 'feature-ia', enabled: true, limit_value: 10, config: {} }],
      overrides: [{ id: 'override-expirado', feature_id: 'feature-ia', enabled: false, limit_value: 1, config: {}, expires_at: '2026-08-20T00:00:00.000Z', revoked_at: null, reason: 'Piloto encerrado' }],
      usage: [],
      now: new Date('2026-08-26T12:00:00.000Z'),
    });

    expect(ai).toMatchObject({ enabled: true, source: 'plan', limitValue: 10, override: null });
  });
});
