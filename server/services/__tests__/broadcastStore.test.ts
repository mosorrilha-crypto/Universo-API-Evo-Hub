/**
 * TASK-0171 — cobre principalmente a lógica de deduplicação (a parte mais
 * fácil de quebrar sem perceber): contato já conhecido do tenant vira
 * `skipped_existing_contact`, contato campanhado recentemente vira
 * `skipped_recent_duplicate`, e os toggles "incluir mesmo assim" revertem
 * isso — além da divisão da lista entre números por `allocation_count`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
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
});
