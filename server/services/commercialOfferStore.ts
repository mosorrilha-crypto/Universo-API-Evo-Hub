import { getPlatformDb } from './db';

export type CommercialPlanKey = 'essencial' | 'profissional';

export interface PublicCommercialPlan {
  key: CommercialPlanKey;
  name: string;
  description: string | null;
  price: string;
  featured: boolean;
  audience: string;
  capabilities: Array<{ key: string; name: string; limit: number | null }>;
}

const PLAN_KEYS: CommercialPlanKey[] = ['essencial', 'profissional'];

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publicPlanMetadata(value: unknown) {
  const metadata = asObject(value);
  return {
    price: typeof metadata.display_price === 'string' ? metadata.display_price : 'Consulte nossa equipe',
    featured: metadata.featured === true,
    audience: typeof metadata.audience === 'string' ? metadata.audience : 'Negócios que querem organizar sua operação comercial.',
  };
}

export async function getPublicCommercialOffer(): Promise<PublicCommercialPlan[]> {
  const db = getPlatformDb();
  const { data: plans, error: plansError } = await db
    .from('plans')
    .select('id, key, name, description, commercial_metadata')
    .in('key', PLAN_KEYS)
    .eq('version', 1)
    .eq('status', 'active');
  if (plansError) throw new Error(plansError.message);

  const planRows = (plans || []) as Array<{ id: string; key: CommercialPlanKey; name: string; description: string | null; commercial_metadata: unknown }>;
  if (!planRows.length) return [];

  const { data: rules, error: rulesError } = await db
    .from('plan_feature_rules')
    .select('plan_id, enabled, limit_value, features!inner(key, name, status)')
    .in('plan_id', planRows.map((plan) => plan.id))
    .eq('enabled', true)
    .eq('features.status', 'active');
  if (rulesError) throw new Error(rulesError.message);

  const capabilitiesByPlan = new Map<string, PublicCommercialPlan['capabilities']>();
  for (const rule of (rules || []) as Array<{ plan_id: string; limit_value: number | null; features: { key: string; name: string; status: string } | { key: string; name: string; status: string }[] }>) {
    const feature = Array.isArray(rule.features) ? rule.features[0] : rule.features;
    if (!feature) continue;
    const current = capabilitiesByPlan.get(rule.plan_id) || [];
    current.push({ key: feature.key, name: feature.name, limit: rule.limit_value });
    capabilitiesByPlan.set(rule.plan_id, current);
  }

  return planRows
    .map((plan) => {
      const metadata = publicPlanMetadata(plan.commercial_metadata);
      return {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        ...metadata,
        capabilities: (capabilitiesByPlan.get(plan.id) || []).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
      };
    })
    .sort((left, right) => PLAN_KEYS.indexOf(left.key) - PLAN_KEYS.indexOf(right.key));
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function createCommercialInterest(input: unknown) {
  const body = asObject(input);
  const planKey = cleanText(body.planKey, 32) as CommercialPlanKey;
  const name = cleanText(body.name, 120);
  const businessName = cleanText(body.businessName, 160);
  const whatsapp = cleanText(body.whatsapp, 32).replace(/[^\d+]/g, '');
  const email = cleanText(body.email, 160);
  const note = cleanText(body.note, 600);
  const consent = body.consent === true;

  if (!PLAN_KEYS.includes(planKey)) throw new Error('Selecione uma oferta válida.');
  if (name.length < 2) throw new Error('Informe seu nome.');
  if (businessName.length < 2) throw new Error('Informe o nome do negócio.');
  if (whatsapp.replace(/\D/g, '').length < 8) throw new Error('Informe um WhatsApp válido.');
  if (!consent) throw new Error('Confirme o consentimento para receber contato sobre a oferta.');

  const { data, error } = await getPlatformDb()
    .from('commercial_interest_requests')
    .insert({
      plan_key: planKey,
      name,
      business_name: businessName,
      whatsapp,
      email: email || null,
      note: note || null,
      consent_at: new Date().toISOString(),
    })
    .select('id, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}
