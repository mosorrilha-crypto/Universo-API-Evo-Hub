import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

vi.mock('../googleCalendar', () => ({
  getAuthorizedGoogleClient: vi.fn().mockResolvedValue({}),
}));

const sheetsApiMock = {
  spreadsheets: {
    create: vi.fn(),
    values: {
      update: vi.fn().mockResolvedValue({}),
      get: vi.fn(),
      append: vi.fn().mockResolvedValue({}),
    },
  },
};

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => sheetsApiMock),
  },
}));

const { syncLeadToSheet, queueLeadSheetSync } = await import('../googleSheetsSync');
const { getAuthorizedGoogleClient } = await import('../googleCalendar');

const config = { clientId: 'x', clientSecret: 'y', redirectUri: 'z' };

describe('googleSheetsSync — backup em Google Sheets dos leads (TASK-0185)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthorizedGoogleClient as any).mockResolvedValue({});
  });

  it('cria a planilha (com header) na primeira sincronização do tenant e grava a linha nova', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-1', name: 'Studio X' }] }));
    sheetsApiMock.spreadsheets.create.mockResolvedValue({
      data: { spreadsheetId: 'sheet-abc', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc' },
    });
    sheetsApiMock.spreadsheets.values.get.mockResolvedValue({ data: { values: [] } });

    await syncLeadToSheet('tenant-1', config, {
      phone: '5511999999999',
      name: 'Fernanda',
      firstContactIso: '2026-08-01T10:00:00Z',
      interest: 'botox',
      scheduled: true,
    });

    expect(sheetsApiMock.spreadsheets.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ properties: { title: 'Clientes - Studio X' } }),
    }));
    expect(sheetsApiMock.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'sheet-abc',
      range: 'Clientes!A1:G1',
      requestBody: { values: [['Primeiro contato', 'Cliente (WhatsApp)', 'Nome', 'Interesse', 'Agendou?', 'Observações', 'Última atualização']] },
    }));
    expect(sheetsApiMock.spreadsheets.values.append).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'sheet-abc',
      requestBody: { values: [expect.arrayContaining(['5511999999999', 'Fernanda', 'botox', 'sim'])] },
    }));
  });

  it('reaproveita a planilha já criada (não cria de novo) e atualiza a linha existente sem apagar Interesse/Observações preenchidos manualmente na planilha', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-1', name: 'Studio X', backup_sheet_id: 'sheet-abc', backup_sheet_url: 'https://x' }] }));
    sheetsApiMock.spreadsheets.values.get
      .mockResolvedValueOnce({ data: { values: [['Primeiro contato'], ['5511999999999']] } })
      .mockResolvedValueOnce({ data: { values: [['01/08/2026', '5511999999999', 'Fernanda', 'botox antigo', 'não', 'observação manual', '01/08/2026']] } });

    await syncLeadToSheet('tenant-1', config, {
      phone: '5511999999999',
      name: 'Fernanda',
      firstContactIso: '2026-08-01T10:00:00Z',
      scheduled: true,
    });

    expect(sheetsApiMock.spreadsheets.create).not.toHaveBeenCalled();
    expect(sheetsApiMock.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'sheet-abc',
      range: 'Clientes!A2:G2',
      requestBody: { values: [expect.arrayContaining(['botox antigo', 'sim', 'observação manual'])] },
    }));
  });

  it('queueLeadSheetSync nunca lança mesmo quando a sincronização falha (fire-and-forget)', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-1', name: 'Studio X' }] }));
    (getAuthorizedGoogleClient as any).mockRejectedValue(new Error('Google Calendar não está conectado.'));

    expect(() => queueLeadSheetSync('tenant-1', config, {
      phone: '5511999999999',
      firstContactIso: '2026-08-01T10:00:00Z',
      scheduled: false,
    })).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('queueLeadSheetSync não tenta sincronizar quando o Google não está configurado neste ambiente', () => {
    expect(() => queueLeadSheetSync('tenant-1', undefined, {
      phone: '5511999999999',
      firstContactIso: '2026-08-01T10:00:00Z',
      scheduled: false,
    })).not.toThrow();

    expect(getAuthorizedGoogleClient).not.toHaveBeenCalled();
  });
});
