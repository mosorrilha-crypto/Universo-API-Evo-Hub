/**
 * Cria (ou atualiza a senha de) um operador real na tabela `operators` —
 * é o que destrava DEMO_MODE=false em produção (server/routes/auth.ts já
 * consulta essa tabela em /api/auth/login, só faltava ela existir com
 * linhas de verdade).
 *
 * Rode com as env vars reais de produção:
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/create-operator.ts \
 *     --email monique@pestanaspormonique.com --password "SENHA-FORTE-AQUI" \
 *     --name "Monique" --role admin [--tenant <uuid>]
 *
 * --tenant é opcional — sem ele, usa o tenant legado único
 * (11111111-1111-1111-1111-111111111111). --role aceita: operator, manager,
 * admin, saas_admin (saas_admin enxerga todos os tenants, uso reservado ao
 * dono da plataforma).
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const LEGACY_DEFAULT_TENANT_ID = '11111111-1111-1111-1111-111111111111';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { email, password, name, role = 'admin', tenant = LEGACY_DEFAULT_TENANT_ID } = args;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY no ambiente.');
    process.exit(1);
  }
  if (!email || !password || !name) {
    console.error('❌ Uso: npx tsx scripts/create-operator.ts --email <email> --password <senha> --name <nome> [--role admin|manager|operator|saas_admin] [--tenant <uuid>]');
    process.exit(1);
  }
  if (!['operator', 'manager', 'admin', 'saas_admin'].includes(role)) {
    console.error(`❌ Role inválida: ${role}`);
    process.exit(1);
  }

  const db = createClient(supabaseUrl, supabaseKey);
  const passwordHash = await bcrypt.hash(password, 10);

  const { error } = await db
    .from('operators')
    .upsert({ tenant_id: tenant, email, password_hash: passwordHash, name, role }, { onConflict: 'tenant_id,email' });

  if (error) {
    console.error('❌ Falha ao criar/atualizar operador:', error.message);
    process.exit(1);
  }
  console.log(`✅ Operador ${email} (role: ${role}) pronto no tenant ${tenant}. Login em /api/auth/login com esse e-mail/senha.`);
}

main();
