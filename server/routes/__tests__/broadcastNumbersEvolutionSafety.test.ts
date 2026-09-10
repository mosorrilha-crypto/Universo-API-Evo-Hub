/**
 * TASK-0367 — pedido direto ("o menor lote possível primeiro e espaçamento
 * maior"): número Evolution nunca pode ser configurado mais agressivo que o
 * piso/teto de segurança, nem na criação nem depois via PATCH. Testa só a
 * validação da rota (mocka broadcastStore inteiro) — a lógica de fato usar
 * esses valores no envio já é coberta por broadcastSenderJob.test.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBroadcastNumber: vi.fn().mockResolvedValue({ id: 'num-new', provider: 'evolution', accessToken: null }),
  updateBroadcastNumber: vi.fn().mockResolvedValue({ id: 'num-1', provider: 'evolution', accessToken: null }),
  getBroadcastNumber: vi.fn().mockResolvedValue({ id: 'num-1', provider: 'evolution', accessToken: null }),
  listBroadcastNumbers: vi.fn().mockResolvedValue([]),
  deleteBroadcastNumber: vi.fn(),
}));

vi.mock('../../services/broadcastStore', () => ({
  ...mocks,
  listBroadcastTemplates: vi.fn(),
  createBroadcastTemplate: vi.fn(),
  updateBroadcastTemplate: vi.fn(),
  deleteBroadcastTemplate: vi.fn(),
  getBroadcastTemplate: vi.fn(),
  importContactList: vi.fn(),
  createContactListFromSegment: vi.fn(),
  listContactLists: vi.fn(),
  getContactListContacts: vi.fn(),
  getContactList: vi.fn(),
  deleteContactList: vi.fn(),
  previewCampaignAllocation: vi.fn(),
  createCampaign: vi.fn(),
  listCampaigns: vi.fn(),
  getCampaign: vi.fn(),
  listCampaignNumberAllocations: vi.fn(),
  listCampaignTemplateLinks: vi.fn(),
  getCampaignCounts: vi.fn(),
  listCampaignRecipients: vi.fn(),
  updateCampaignStatus: vi.fn(),
  updateCampaignSchedule: vi.fn(),
  transitionCampaignToRunning: vi.fn(),
}));

vi.mock('../../services/metaSend', () => ({
  uploadWhatsAppMedia: vi.fn(),
  sendWhatsAppTemplateMessage: vi.fn(),
}));

import { createBroadcastRouter } from '../broadcast';

let server: Server;
let baseUrl: string;
const TENANT_ID = 'tenant-from-jwt';

function authenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-1', tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createBroadcastRouter({ authenticateToken: authenticateToken as any }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  mocks.createBroadcastNumber.mockClear();
  mocks.updateBroadcastNumber.mockClear();
  mocks.getBroadcastNumber.mockClear();
});

describe('POST /api/admin/broadcast-numbers — piso/teto de segurança pra provider Evolution', () => {
  it('rejeita minGapSeconds abaixo do piso de segurança', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'evo-1', provider: 'evolution', minGapSeconds: 10 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/espaçamento/i);
    expect(mocks.createBroadcastNumber).not.toHaveBeenCalled();
  });

  it('rejeita perMinuteCap acima do teto de segurança', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'evo-1', provider: 'evolution', perMinuteCap: 50 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/por minuto/i);
    expect(mocks.createBroadcastNumber).not.toHaveBeenCalled();
  });

  it('rejeita dailyCap acima do teto de segurança', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'evo-1', provider: 'evolution', dailyCap: 5000 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/por dia/i);
    expect(mocks.createBroadcastNumber).not.toHaveBeenCalled();
  });

  it('aceita valores dentro do piso/teto de segurança', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'evo-1', provider: 'evolution', minGapSeconds: 60, perMinuteCap: 1, dailyCap: 20 }),
    });
    expect(res.status).toBe(201);
    expect(mocks.createBroadcastNumber).toHaveBeenCalledTimes(1);
  });

  it('provider "meta" não tem esse piso/teto (comportamento de sempre)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'pnid-1', provider: 'meta', minGapSeconds: 1, perMinuteCap: 1000, dailyCap: 100000 }),
    });
    expect(res.status).toBe(201);
    expect(mocks.createBroadcastNumber).toHaveBeenCalledTimes(1);
  });

  it('rejeita provider desconhecido', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'N1', phoneNumberId: 'x', provider: 'whatsapp-web-generico' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/broadcast-numbers/:id — mesmo piso/teto reconferido contra o número já salvo', () => {
  it('rejeita baixar o minGapSeconds de um número Evolution já existente abaixo do piso', async () => {
    const res = await fetch(`${baseUrl}/api/admin/broadcast-numbers/num-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minGapSeconds: 5 }),
    });
    expect(res.status).toBe(400);
    expect(mocks.updateBroadcastNumber).not.toHaveBeenCalled();
  });
});
