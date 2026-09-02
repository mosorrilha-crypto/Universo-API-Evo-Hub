/**
 * Backfill de criptografia em repouso — fase 2 (item 2 da auditoria de
 * segurança, 02/09/2026): cifra com AES-256-GCM (tokenCrypto.ts) as
 * credenciais de terceiros que ainda estavam em texto puro fora do Google
 * Calendar (esse já coberto por encrypt-calendar-tokens.ts, fase 1):
 * Evolution API, Meta Cloud API/Ads/CAPI, Instagram e números de broadcast.
 *
 * Não é obrigatório rodar isso pro código funcionar: `decryptSecret` já
 * reconhece texto puro legado (sem o prefixo "v1:") e devolve como está —
 * cada credencial continua sendo lida normalmente sem este backfill. Este
 * script só ACELERA a proteção pros tenants já conectados antes da mudança,
 * sem esperar eles reconfigurarem a credencial sozinhos.
 *
 * Idempotente: pula qualquer valor que já comece com "v1:" (já cifrado).
 * Seguro rodar de novo.
 *
 *   TOKEN_ENCRYPTION_KEY=... SUPABASE_URL=... SUPABASE_KEY=... \
 *     npx tsx scripts/encrypt-phase2-credentials.ts
 */
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../server/services/tokenCrypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY no ambiente antes de rodar este script.');
  process.exit(1);
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.error('❌ Defina TOKEN_ENCRYPTION_KEY no ambiente antes de rodar este script (senão as credenciais seriam regravadas sem cifrar).');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

interface TargetTable {
  table: string;
  idColumn: string;
  secretColumns: string[];
}

const TARGETS: TargetTable[] = [
  { table: 'tenant_evolution_credentials', idColumn: 'tenant_id', secretColumns: ['api_key'] },
  { table: 'tenant_meta_credentials', idColumn: 'tenant_id', secretColumns: ['access_token', 'capi_access_token', 'meta_ads_access_token', 'meta_ads_management_access_token'] },
  { table: 'tenant_instagram_credentials', idColumn: 'tenant_id', secretColumns: ['access_token'] },
  { table: 'broadcast_numbers', idColumn: 'id', secretColumns: ['access_token'] },
];

async function backfillTable(target: TargetTable): Promise<{ encrypted: number; skipped: number }> {
  const { data, error } = await db.from(target.table).select([target.idColumn, ...target.secretColumns].join(', '));
  if (error) throw error;

  let encrypted = 0;
  let skipped = 0;
  for (const row of (data as any[]) || []) {
    const patch: Record<string, string> = {};
    for (const column of target.secretColumns) {
      const value = row[column];
      if (!value || typeof value !== 'string' || value.startsWith('v1:')) continue;
      patch[column] = encryptSecret(value);
    }
    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }
    const { error: updateError } = await db.from(target.table).update(patch).eq(target.idColumn, row[target.idColumn]);
    if (updateError) throw updateError;
    encrypted += 1;
  }
  return { encrypted, skipped };
}

async function main() {
  for (const target of TARGETS) {
    const { encrypted, skipped } = await backfillTable(target);
    console.log(`✅ ${target.table}: cifrados ${encrypted}. Já cifrados/vazios (pulados): ${skipped}.`);
  }
}

main().catch((err) => {
  console.error('❌ Falha no backfill:', err);
  process.exit(1);
});
