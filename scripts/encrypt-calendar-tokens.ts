/**
 * Backfill de criptografia em repouso (item 2 da auditoria de segurança,
 * 02/09/2026) — cifra com AES-256-GCM (tokenCrypto.ts) qualquer
 * `refresh_token` já gravado em texto puro em `tenant_calendar_tokens`.
 *
 * Não é obrigatório rodar isso pro código funcionar: `decryptSecret` já
 * reconhece texto puro legado (sem o prefixo "v1:") e devolve como está —
 * o refresh token continua sendo lido normalmente sem este backfill. Este
 * script só ACELERA a proteção pros tenants que já conectaram antes da
 * mudança, sem esperar eles reconectarem/rotacionarem o token sozinhos.
 *
 * Idempotente: pula qualquer linha que já comece com "v1:" (já cifrada).
 * Seguro rodar de novo.
 *
 *   TOKEN_ENCRYPTION_KEY=... SUPABASE_URL=... SUPABASE_KEY=... \
 *     npx tsx scripts/encrypt-calendar-tokens.ts
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
  console.error('❌ Defina TOKEN_ENCRYPTION_KEY no ambiente antes de rodar este script (senão os tokens seriam regravados sem cifrar).');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await db.from('tenant_calendar_tokens').select('tenant_id, refresh_token');
  if (error) throw error;

  let encrypted = 0;
  let skipped = 0;
  for (const row of data || []) {
    if (!row.refresh_token || row.refresh_token.startsWith('v1:')) {
      skipped += 1;
      continue;
    }
    const { error: updateError } = await db
      .from('tenant_calendar_tokens')
      .update({ refresh_token: encryptSecret(row.refresh_token) })
      .eq('tenant_id', row.tenant_id);
    if (updateError) throw updateError;
    encrypted += 1;
  }

  console.log(`✅ Cifrados: ${encrypted}. Já cifrados/vazios (pulados): ${skipped}.`);
}

main().catch((err) => {
  console.error('❌ Falha no backfill:', err);
  process.exit(1);
});
