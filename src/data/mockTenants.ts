import { Tenant } from '../types';

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
