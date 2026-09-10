-- TASK-0185 — backup em Google Sheets dos leads/agendamentos, pedido direto
-- do dono do produto (referência: planilha "Clientes - Renov" mostrada num
-- vídeo externo). Guarda o spreadsheet criado automaticamente na primeira
-- sincronização de cada tenant (ver server/services/googleSheetsSync.ts) —
-- nunca é a fonte de verdade (isso continua sendo o Postgres/Supabase), só
-- um espelho legível fora do banco.
alter table if exists tenants
  add column if not exists backup_sheet_id text,
  add column if not exists backup_sheet_url text;
