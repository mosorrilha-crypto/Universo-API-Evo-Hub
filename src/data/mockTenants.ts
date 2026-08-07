import { Tenant, UserProfile } from '../types';

// Achado a pedido do dono do tenant (07/08/2026): os 3 tenants fictícios
// (Drogaria & Manipulação Viva, MetaLeads Imóveis, FitLife) eram só dados de
// demonstração do template original do SaaS — nunca foram clientes reais.
// Mantido só o tenant real (Monique Sorrilha Beauty Studio) pra eliminar
// qualquer risco de confundir o seletor de empresa com um negócio fictício
// enquanto a plataforma já está recebendo leads de verdade.
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
  {
    id: 'usr_ricardo',
    tenantId: 'tenant_004',
    name: 'Ricardo Santos (SaaS Master)',
    email: 'ricardo.master@saasplatform.com',
    role: 'saas_admin',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    department: 'Diretoria SaaS & Infraestrutura Global',
  },
];
