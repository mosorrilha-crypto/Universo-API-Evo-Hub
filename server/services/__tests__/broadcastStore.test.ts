/**
 * TASK-0171 — cobre principalmente a lógica de deduplicação (a parte mais
 * fácil de quebrar sem perceber): contato já conhecido do tenant vira
 * `skipped_existing_contact`, contato campanhado recentemente vira
 * `skipped_recent_duplicate`, e os toggles "incluir mesmo assim" revertem
 * isso — além da divisão da lista entre números por `allocation_count`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

vi.mock('../metaSend', () => ({
  uploadWhatsAppMedia: vi.fn().mockResolvedValue('media-id-test'),
  sendWhatsAppTemplateMessage: vi.fn(),
}));
import { uploadWhatsAppMedia } from '../metaSend';
import {
  createBroadcastNumber,
  listBroadcastNumbers,
  updateBroadcastNumber,
  createBroadcastTemplate,
  importContactList,
  previewCampaignAllocation,
  createCampaign,
  getCampaignCounts,
  listCampaignNumberAllocations,
  updateCampaignStatus,
  updateCampaignSchedule,
  transitionCampaignToRunning,
  listScheduledCampaignsDueToStart,
} from '../broadcastStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('broadcastNumbers CRUD', () => {
  it('cria e lista números, nunca expondo o token cru pra fora do store (isso é responsabilidade da rota, mas o valor salvo tem que estar lá)', async () => {
    await createBroadcastNumber(TENANT_A, { label: 'Corrida ELAS', phoneNumberId: 'pnid-1', accessToken: 'secreto' });
    const numbers = await listBroadcastNumbers(TENANT_A);
    expect(numbers).toHaveLength(1);
    expect(numbers[0].label).toBe('Corrida ELAS');
    expect(numbers[0].accessToken).toBe('secreto');
    expect(numbers[0].status).toBe('warming');
    expect(numbers[0].warmupProgressDays).toBe(0);
  });

  it('campo de token em branco no update NUNCA apaga o token já salvo', async () => {
    const created = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1', accessToken: 'token-original' });
    const updated = await updateBroadcastNumber(TENANT_A, created.id, { label: 'N1 renomeado', accessToken: '' });
    expect(updated?.accessToken).toBe('token-original');
    expect(updated?.label).toBe('N1 renomeado');
  });
});

async function importList(name: string, csv: string) {
  return importContactList(TENANT_A, name, 'lista.csv', csv, null);
}

describe('importContactList', () => {
  it('importa contatos e reporta duplicatas ignoradas', async () => {
    const result = await importList('Lista 1', 'phone,name\n595981111111,A\n595981111111,A dup\n595982222222,B');
    expect(result.imported).toBe(2);
    expect(result.duplicatesIgnored).toBe(1);
    expect(result.list.contactCount).toBe(2);
  });

  it('lança erro quando o CSV não tem nenhum contato válido', async () => {
    await expect(importList('Vazia', 'phone,name\n,')).rejects.toThrow();
  });
});

describe('previewCampaignAllocation e createCampaign — deduplicação', () => {
  async function setupTemplateAndNumber() {
    const template = await createBroadcastTemplate(TENANT_A, {
      name: 'corrida_elas', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: ['nome'],
    });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1', accessToken: 'tok' });
    return { template, number };
  }

  it('contato que já tem conversation vira skipped_existing_contact por padrão, e não recebe pending', async () => {
    const { template, number } = await setupTemplateAndNumber();
    const list = await importList('Lista', 'phone,name\n595981111111,Já Conhecido\n595982222222,Novo');
    await getDb().from('conversations').insert({ tenant_id: TENANT_A, phone: '595981111111', name: 'Já Conhecido' });

    const preview = await previewCampaignAllocation(TENANT_A, list.list.id, 3);
    expect(preview.totalContacts).toBe(2);
    expect(preview.skippedExistingContact).toBe(1);
    expect(preview.toSend).toBe(1);

    const campaign = await createCampaign(TENANT_A, {
      name: 'Campanha 1', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    const counts = await getCampaignCounts(TENANT_A, campaign.id);
    expect(counts.total.skippedExistingContact).toBe(1);
    expect(counts.total.pending).toBe(1);
  });

  it('toggle includeExistingContacts inclui o contato já conhecido mesmo assim', async () => {
    const { template, number } = await setupTemplateAndNumber();
    const list = await importList('Lista', 'phone,name\n595981111111,Já Conhecido');
    await getDb().from('conversations').insert({ tenant_id: TENANT_A, phone: '595981111111', name: 'Já Conhecido' });

    const campaign = await createCampaign(TENANT_A, {
      name: 'Campanha 2', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }],
      includeExistingContacts: true, createdBy: null,
    });
    const counts = await getCampaignCounts(TENANT_A, campaign.id);
    expect(counts.total.skippedExistingContact).toBe(0);
    expect(counts.total.pending).toBe(1);
  });

  it('contato que já recebeu campanha "sent" recente vira skipped_recent_duplicate na campanha seguinte', async () => {
    const { template, number } = await setupTemplateAndNumber();
    const list1 = await importList('Lista 1', 'phone,name\n595981111111,Contato');
    const campaign1 = await createCampaign(TENANT_A, {
      name: 'Campanha 1', templateId: template.id, contactListId: list1.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    // Simula que o job já enviou de verdade pra esse destinatário.
    await getDb().from('broadcast_campaign_recipients')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('campaign_id', campaign1.id)
      .eq('phone', '595981111111');

    const list2 = await importList('Lista 2', 'phone,name\n595981111111,Mesmo Contato');
    const preview = await previewCampaignAllocation(TENANT_A, list2.list.id, 3);
    expect(preview.skippedRecentDuplicate).toBe(1);
    expect(preview.toSend).toBe(0);

    const campaign2 = await createCampaign(TENANT_A, {
      name: 'Campanha 2', templateId: template.id, contactListId: list2.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    const counts2 = await getCampaignCounts(TENANT_A, campaign2.id);
    expect(counts2.total.skippedRecentDuplicate).toBe(1);
    expect(counts2.total.pending).toBe(0);
  });

  it('divide os contatos entre números na ordem das allocations, em blocos sequenciais', async () => {
    const { template } = await setupTemplateAndNumber();
    const numberB = await createBroadcastNumber(TENANT_A, { label: 'N2', phoneNumberId: 'pnid-2', accessToken: 'tok2' });
    const numbers = await listBroadcastNumbers(TENANT_A);
    const numberA = numbers.find((n) => n.phoneNumberId === 'pnid-1')!;

    const csvRows = Array.from({ length: 4 }, (_, i) => `59598${String(i).padStart(7, '0')},Contato ${i}`).join('\n');
    const list = await importList('Lista Grande', `phone,name\n${csvRows}`);

    const campaign = await createCampaign(TENANT_A, {
      name: 'Campanha dividida', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true,
      numberAllocations: [{ broadcastNumberId: numberA.id, count: 2 }, { broadcastNumberId: numberB.id, count: 2 }],
      createdBy: null,
    });

    const allocations = await listCampaignNumberAllocations(TENANT_A, campaign.id);
    expect(allocations).toHaveLength(2);
    const counts = await getCampaignCounts(TENANT_A, campaign.id);
    expect(counts.byNumber[numberA.id].pending).toBe(2);
    expect(counts.byNumber[numberB.id].pending).toBe(2);
  });

  it('rejeita criar campanha sem consentimento confirmado', async () => {
    const { template, number } = await setupTemplateAndNumber();
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    await expect(createCampaign(TENANT_A, {
      name: 'Sem consentimento', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: false, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    })).rejects.toThrow(/consentimento/i);
  });
});

describe('updateCampaignStatus', () => {
  it('rejeita transição inválida (ex: completed -> running)', async () => {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await expect(updateCampaignStatus(TENANT_A, campaign.id, 'running')).resolves.toBeTruthy();
    await expect(updateCampaignStatus(TENANT_A, campaign.id, 'completed')).resolves.toBeTruthy();
    await expect(updateCampaignStatus(TENANT_A, campaign.id, 'running')).rejects.toThrow(/Transição de status inválida/);
  });

  it('rejeita agendar ("scheduled") sem scheduledAt definido antes', async () => {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await expect(updateCampaignStatus(TENANT_A, campaign.id, 'scheduled')).rejects.toThrow(/scheduledAt/);
  });

  it('permite voltar de "scheduled" pra "draft" (desagendar sem cancelar a campanha)', async () => {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await updateCampaignSchedule(TENANT_A, campaign.id, { scheduledAt: '2026-09-01T12:00:00.000Z' });
    await updateCampaignStatus(TENANT_A, campaign.id, 'scheduled');
    const backToDraft = await updateCampaignStatus(TENANT_A, campaign.id, 'draft');
    expect(backToDraft.status).toBe('draft');
  });
});

describe('updateCampaignSchedule', () => {
  async function setupCampaign() {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    return createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
  }

  it('salva scheduledAt e janela de horário válidos', async () => {
    const campaign = await setupCampaign();
    const updated = await updateCampaignSchedule(TENANT_A, campaign.id, {
      scheduledAt: '2026-09-01T12:00:00.000Z', sendWindowStart: '09:00', sendWindowEnd: '18:00', sendWindowTimezone: 'America/Sao_Paulo',
    });
    expect(updated.scheduledAt).toBe('2026-09-01T12:00:00.000Z');
    expect(updated.sendWindowStart).toBe('09:00');
    expect(updated.sendWindowEnd).toBe('18:00');
    expect(updated.sendWindowTimezone).toBe('America/Sao_Paulo');
  });

  it('rejeita horário de janela em formato inválido', async () => {
    const campaign = await setupCampaign();
    await expect(updateCampaignSchedule(TENANT_A, campaign.id, { sendWindowStart: '9h', sendWindowEnd: '18:00' })).rejects.toThrow(/HH:MM/);
  });

  it('rejeita definir só um lado da janela (início sem fim, ou vice-versa)', async () => {
    const campaign = await setupCampaign();
    await expect(updateCampaignSchedule(TENANT_A, campaign.id, { sendWindowStart: '09:00' })).rejects.toThrow(/dois horários/);
  });

  it('rejeita fuso horário desconhecido', async () => {
    const campaign = await setupCampaign();
    await expect(updateCampaignSchedule(TENANT_A, campaign.id, { sendWindowTimezone: 'Marte/Base_Um' })).rejects.toThrow(/não é reconhecido/);
  });

  it('rejeita data/hora inválida em scheduledAt', async () => {
    const campaign = await setupCampaign();
    await expect(updateCampaignSchedule(TENANT_A, campaign.id, { scheduledAt: 'não é uma data' })).rejects.toThrow(/válida/);
  });
});

describe('transitionCampaignToRunning', () => {
  it('template sem cabeçalho de imagem: só transiciona status, nunca chama upload', async () => {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    const running = await transitionCampaignToRunning(TENANT_A, campaign.id);
    expect(running.status).toBe('running');
    expect(running.headerMediaId).toBeNull();
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it('template com cabeçalho de imagem: faz upload uma vez e grava headerMediaId', async () => {
    const template = await createBroadcastTemplate(TENANT_A, {
      name: 't', language: 'pt_BR', category: 'marketing', headerType: 'image', bodyVariableLabels: [],
      headerImageBase64: 'data:image/jpeg;base64,QQ==',
    });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1', accessToken: 'tok' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    const running = await transitionCampaignToRunning(TENANT_A, campaign.id);
    expect(running.status).toBe('running');
    expect(running.headerMediaId).toBe('media-id-test');
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(1);
  });

  it('template com cabeçalho de imagem mas sem imagem salva: rejeita antes de rodar', async () => {
    const template = await createBroadcastTemplate(TENANT_A, {
      name: 't', language: 'pt_BR', category: 'marketing', headerType: 'image', bodyVariableLabels: [],
    });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');
    const campaign = await createCampaign(TENANT_A, {
      name: 'C', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await expect(transitionCampaignToRunning(TENANT_A, campaign.id)).rejects.toThrow(/nenhuma imagem foi salva/);
  });
});

describe('listScheduledCampaignsDueToStart', () => {
  it('só devolve campanhas "scheduled" cuja hora marcada já chegou — não as futuras nem as de outro status', async () => {
    const template = await createBroadcastTemplate(TENANT_A, { name: 't', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabels: [] });
    const number = await createBroadcastNumber(TENANT_A, { label: 'N1', phoneNumberId: 'pnid-1' });
    const list = await importList('Lista', 'phone,name\n595981111111,A');

    const due = await createCampaign(TENANT_A, {
      name: 'Já passou da hora', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await updateCampaignSchedule(TENANT_A, due.id, { scheduledAt: '2000-01-01T00:00:00.000Z' });
    await updateCampaignStatus(TENANT_A, due.id, 'scheduled');

    const future = await createCampaign(TENANT_A, {
      name: 'Ainda não chegou a hora', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });
    await updateCampaignSchedule(TENANT_A, future.id, { scheduledAt: '2999-01-01T00:00:00.000Z' });
    await updateCampaignStatus(TENANT_A, future.id, 'scheduled');

    const draft = await createCampaign(TENANT_A, {
      name: 'Rascunho', templateId: template.id, contactListId: list.list.id, dedupeWindowDays: 3,
      consentConfirmed: true, numberAllocations: [{ broadcastNumberId: number.id, count: 10 }], createdBy: null,
    });

    const dueList = await listScheduledCampaignsDueToStart();
    const dueIds = dueList.map((d) => d.campaignId);
    expect(dueIds).toContain(due.id);
    expect(dueIds).not.toContain(future.id);
    expect(dueIds).not.toContain(draft.id);
  });
});
