import { Tenant, UserProfile } from '../types';

// As 3 empresas fictícias de demonstração (Drogaria Viva, MetaLeads Imóveis,
// FitLife) foram removidas para produção — só resta o tenant real.
export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant_004',
    name: 'Monique Sorrilha Beauty Studio',
    slug: 'monique-beauty-studio',
    plan: 'enterprise',
    monthlyMRR: 1800,
    status: 'ativo',
    createdAt: '01/08/2026',
    whatsappPhone: '595981123456',
    whatsappStatus: 'conectado',
    whatsappEngine: 'zapi_managed',
    zapiInstanceId: 'MONIQUE-STUDIO-ZAPI',
    zapiToken: 'MONIQUE-SECURE-TOKEN-2026',
    failoverEnabled: true,
    autoReconnectCount: 0,
    maxLeadsPerMonth: 10000,
    currentLeadsMonth: 2450,
    webhookEndpoint: `${window.location.origin}/api/webhooks/whatsapp?tenantId=tenant_004`,
    metaPixelId: '554433221100998',
  },
];

// Os 3 logins de demonstração (Carlos, Fernanda, Ricardo) foram removidos
// para produção — só resta o login real da Monique. Mantido em sincronia
// manual com server/routes/auth.ts (DEMO_USERS) e
// src/components/LoginModal.tsx (USER_PASSWORDS).
export const SAAS_DEMO_USERS: UserProfile[] = [
  {
    id: 'usr_monique',
    tenantId: 'tenant_004',
    name: 'Monique Sorrilha',
    email: 'monique@pestanaspormonique.com',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    department: 'Especialista em Micropigmentação & Estúdio',
  },
];
