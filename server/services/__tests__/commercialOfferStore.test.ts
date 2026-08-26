import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ getPlatformDb: vi.fn() }));

import { getPlatformDb } from '../db';
import { createCommercialInterest, getPublicCommercialOffer } from '../commercialOfferStore';

const getPlatformDbMock = vi.mocked(getPlatformDb);

function mockInsertDb() {
  const single = vi.fn().mockResolvedValue({ data: { id: 'interest-1', created_at: '2026-08-26T00:00:00Z' }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { from: vi.fn().mockReturnValue({ insert }), insert, single };
}

function mockPublicOfferDb() {
  const plans = [
    { id: 'plan-profissional', key: 'profissional', name: 'Profissional', description: 'Oferta completa', commercial_metadata: { display_price: 'Gs. 649.000/mês', featured: true, audience: 'Operações em crescimento' } },
    { id: 'plan-essencial', key: 'essencial', name: 'Essencial', description: 'Oferta inicial', commercial_metadata: { display_price: 'Gs. 349.000/mês', audience: 'Operações organizadas' } },
  ];
  const rules = [
    { plan_id: 'plan-profissional', limit_value: 2500, features: { key: 'ai.auto_reply', name: 'Agente de IA', status: 'active' } },
    { plan_id: 'plan-essencial', limit_value: null, features: { key: 'booking.calendar', name: 'Agenda', status: 'active' } },
  ];

  const plansStatus = vi.fn().mockResolvedValue({ data: plans, error: null });
  const plansVersion = vi.fn().mockReturnValue({ eq: plansStatus });
  const plansIn = vi.fn().mockReturnValue({ eq: plansVersion });
  const plansSelect = vi.fn().mockReturnValue({ in: plansIn });

  const rulesFeatureStatus = vi.fn().mockResolvedValue({ data: rules, error: null });
  const rulesEnabled = vi.fn().mockReturnValue({ eq: rulesFeatureStatus });
  const rulesPlanIds = vi.fn().mockReturnValue({ eq: rulesEnabled });
  const rulesSelect = vi.fn().mockReturnValue({ in: rulesPlanIds });

  const from = vi.fn((table: string) => {
    if (table === 'plans') return { select: plansSelect };
    if (table === 'plan_feature_rules') return { select: rulesSelect };
    throw new Error(`Tabela não esperada no teste: ${table}`);
  });

  return { from };
}

describe('getPublicCommercialOffer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna somente os dados comerciais publicáveis, em ordem de oferta, com as capacidades habilitadas', async () => {
    const db = mockPublicOfferDb();
    getPlatformDbMock.mockReturnValue(db as any);

    await expect(getPublicCommercialOffer()).resolves.toEqual([
      expect.objectContaining({
        key: 'essencial', name: 'Essencial', price: 'Gs. 349.000/mês', featured: false,
        capabilities: [{ key: 'booking.calendar', name: 'Agenda', limit: null }],
      }),
      expect.objectContaining({
        key: 'profissional', name: 'Profissional', price: 'Gs. 649.000/mês', featured: true,
        capabilities: [{ key: 'ai.auto_reply', name: 'Agente de IA', limit: 2500 }],
      }),
    ]);

    expect(db.from).toHaveBeenNthCalledWith(1, 'plans');
    expect(db.from).toHaveBeenNthCalledWith(2, 'plan_feature_rules');
  });
});

describe('createCommercialInterest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recusa interesse sem consentimento antes de acessar o banco', async () => {
    await expect(createCommercialInterest({
      planKey: 'essencial', name: 'Ana', businessName: 'Clínica Ana', whatsapp: '+595981234567', consent: false,
    })).rejects.toThrow('Confirme o consentimento');
    expect(getPlatformDbMock).not.toHaveBeenCalled();
  });

  it('persiste somente campos limpos depois de validar a solicitação', async () => {
    const db = mockInsertDb();
    getPlatformDbMock.mockReturnValue(db as any);

    await expect(createCommercialInterest({
      planKey: 'profissional', name: '  Ana  ', businessName: '  Clínica Ana ', whatsapp: '+595 981-234-567', email: ' ana@example.com ', note: ' Quero crescer ', consent: true,
    })).resolves.toEqual({ id: 'interest-1', created_at: '2026-08-26T00:00:00Z' });

    expect(db.from).toHaveBeenCalledWith('commercial_interest_requests');
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      plan_key: 'profissional', name: 'Ana', business_name: 'Clínica Ana', whatsapp: '+595981234567', email: 'ana@example.com', note: 'Quero crescer',
    }));
  });
});
