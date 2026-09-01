/**
 * TASK-0185 — backup em Google Sheets dos leads/agendamentos, pedido direto
 * do dono do produto (referência: planilha "Clientes - Renov" mostrada num
 * vídeo externo, com colunas Primeiro contato / Cliente (WhatsApp) / Nome /
 * Interesse / Agendou? / Observações / Última atualização).
 *
 * NUNCA é a fonte de verdade — isso continua sendo o Postgres/Supabase, como
 * em todo o resto do projeto. É só um espelho legível fora do banco,
 * atualizado em tempo real a cada evento relevante da conversa/agendamento,
 * pra quem quiser abrir uma planilha sem acesso ao painel/banco.
 *
 * Reaproveita o MESMO OAuth já conectado pro Google Calendar (mesmo token em
 * tenant_calendar_tokens, escopo de Sheets somado ao de Calendar em
 * googleCalendar.ts) — evita pedir uma segunda conexão Google separada. Um
 * tenant que conectou o Calendar antes desta mudança precisa reconectar
 * (botão "Conectar Google Calendar" no painel) antes do backup funcionar.
 *
 * Fire-and-forget by design (queueLeadSheetSync): uma falha aqui (Sheets
 * fora do ar, token sem o escopo novo ainda, quota da API) nunca pode
 * derrubar ou atrasar o atendimento real ao cliente.
 */
import { google } from 'googleapis';
import { getDb } from './db';
import { getAuthorizedGoogleClient, type CalendarConfig } from './googleCalendar';

type SheetsClient = ReturnType<typeof google.sheets>;

const SHEET_TAB_NAME = 'Clientes';
const SHEET_HEADERS = ['Primeiro contato', 'Cliente (WhatsApp)', 'Nome', 'Interesse', 'Agendou?', 'Observações', 'Última atualização'];
const TIMEZONE = 'America/Asuncion';

export interface LeadSheetRow {
  phone: string;
  name?: string;
  /** ISO da primeira mensagem já registrada desta conversa. */
  firstContactIso: string;
  /**
   * Sinal real de interesse (ex: título do anúncio que originou o lead) —
   * nunca inventado pela IA. Vazio quando não há nenhum dado confiável;
   * upsertRow preserva o que já estiver escrito manualmente na planilha
   * nesse caso, em vez de apagar uma anotação humana.
   */
  interest?: string;
  scheduled: boolean;
  observation?: string;
}

async function loadSheetId(tenantId: string): Promise<string | null> {
  const db = getDb();
  const { data } = await db.from('tenants').select('backup_sheet_id').eq('id', tenantId).maybeSingle();
  return data?.backup_sheet_id || null;
}

/** Link da planilha de backup já criada pra este tenant, ou undefined se a primeira sincronização ainda não rodou. */
export async function getBackupSheetUrl(tenantId: string): Promise<string | undefined> {
  const db = getDb();
  const { data } = await db.from('tenants').select('backup_sheet_url').eq('id', tenantId).maybeSingle();
  return data?.backup_sheet_url || undefined;
}

async function saveSheetInfo(tenantId: string, sheetId: string, url: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('tenants').update({ backup_sheet_id: sheetId, backup_sheet_url: url }).eq('id', tenantId);
  if (error) throw error;
}

async function loadTenantName(tenantId: string): Promise<string> {
  const db = getDb();
  const { data } = await db.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return data?.name || 'Cliente';
}

/** Cria a planilha na primeira sincronização do tenant; nas seguintes só devolve o id já salvo. */
async function ensureSpreadsheet(tenantId: string, sheets: SheetsClient): Promise<string> {
  const existing = await loadSheetId(tenantId);
  if (existing) return existing;

  const tenantName = await loadTenantName(tenantId);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Clientes - ${tenantName}` },
      sheets: [{ properties: { title: SHEET_TAB_NAME } }],
    },
  });
  const sheetId = created.data.spreadsheetId;
  if (!sheetId) throw new Error('Google Sheets não retornou um spreadsheetId ao criar a planilha.');

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${SHEET_TAB_NAME}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: { values: [SHEET_HEADERS] },
  });

  const url = created.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetId}`;
  await saveSheetInfo(tenantId, sheetId, url);
  return sheetId;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: TIMEZONE });
}

/**
 * Upsert por telefone (coluna B, índice 1 nas linhas retornadas) — atualiza
 * a linha existente ou adiciona uma nova ao final. Preserva Interesse/
 * Observações já preenchidos manualmente na planilha quando este evento não
 * trouxer um valor novo pra essas colunas, em vez de apagar uma anotação
 * humana com uma célula vazia.
 */
async function upsertRow(sheets: SheetsClient, sheetId: string, row: LeadSheetRow): Promise<void> {
  const existingPhones = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB_NAME}!B:B` });
  const phoneColumn = existingPhones.data.values || [];
  const rowIndex = phoneColumn.findIndex((cell) => cell[0] === row.phone);

  const values: string[] = [
    formatDateTime(row.firstContactIso),
    row.phone,
    row.name || '',
    row.interest || '',
    row.scheduled ? 'sim' : 'não',
    row.observation || '',
    formatDateTime(new Date().toISOString()),
  ];

  if (rowIndex > 0) {
    const sheetRowNumber = rowIndex + 1;
    const currentRow = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB_NAME}!A${sheetRowNumber}:G${sheetRowNumber}` });
    const current = currentRow.data.values?.[0] || [];
    if (!row.interest && current[3]) values[3] = current[3];
    if (!row.observation && current[5]) values[5] = current[5];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_TAB_NAME}!A${sheetRowNumber}:G${sheetRowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [values] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_TAB_NAME}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
  }
}

export async function syncLeadToSheet(tenantId: string, config: CalendarConfig, row: LeadSheetRow): Promise<void> {
  const auth = await getAuthorizedGoogleClient(tenantId, config.clientId, config.clientSecret, config.redirectUri);
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = await ensureSpreadsheet(tenantId, sheets);
  await upsertRow(sheets, sheetId, row);
}

/**
 * Fire-and-forget: nunca lança pro chamador, só loga e segue. Chamado a cada
 * evento relevante de um lead (nova mensagem, agendamento criado/cancelado)
 * — se o tenant não tiver o Calendar conectado ainda (sem token, ou token
 * antigo sem o escopo de Sheets), falha silenciosamente aqui em vez de
 * atrapalhar o atendimento real.
 */
export function queueLeadSheetSync(tenantId: string, config: CalendarConfig | undefined, row: LeadSheetRow): void {
  if (!config?.clientId || !config.clientSecret) return;
  syncLeadToSheet(tenantId, config, row).catch((err) => {
    console.warn(`⚠️  [GoogleSheetsSync] Falha ao sincronizar lead (tenant=${tenantId}, phone=${row.phone}): ${(err as Error).message}`);
  });
}
