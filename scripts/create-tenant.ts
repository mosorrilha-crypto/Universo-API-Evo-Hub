/**
 * Bloco 2.D.4 (onboarding manual, decisão já tomada: admin cadastra o
 * cliente novo digitando as credenciais dele, sem esperar o autoatendimento
 * oficial da Meta) — cria um tenant novo + credenciais do WhatsApp dele na
 * tabela `tenant_meta_credentials`. É isso que faz o Bloco 2.B (roteamento
 * por phone_number_id) resolver esse cliente como um tenant separado, com
 * sua própria agenda/base de conhecimento/login, em vez de cair no tenant
 * legado.
 *
 * Depois de rodar este script, use `npm run create:operator -- --tenant
 * <uuid-impresso-aqui>` pra criar o primeiro login desse cliente.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/create-tenant.ts \
 *     --name "Nome do Negócio" --slug negocio-slug \
 *     --phone-number-id 123456789012345 --access-token "EAAxxxxx..." \
 *     [--waba-id 123456789] [--mode shared|byo] \
 *     [--currency PYG] [--locale es-PY] [--secondary-currency BRL] [--secondary-locale pt-BR]
 *
 * --phone-number-id é o "Phone number ID" do WhatsApp Business Platform
 * (Meta Business Suite > WhatsApp Manager > API Setup) desse cliente — não é
 * o número de telefone em si. --access-token é o token de acesso (temporário
 * ou de sistema, dependendo do modo shared/byo).
 */
import { createClient } from '@supabase/supabase-js';

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
  const {
    name,
    slug,
    'phone-number-id': phoneNumberId,
    'access-token': accessToken,
    'waba-id': wabaId,
    mode = 'shared',
    currency = 'PYG',
    locale = 'es-PY',
    'secondary-currency': secondaryCurrency,
    'secondary-locale': secondaryLocale,
  } = args;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY no ambiente.');
    process.exit(1);
  }
  if (!name || !phoneNumberId || !accessToken) {
    console.error('❌ Uso: npx tsx scripts/create-tenant.ts --name <nome> --phone-number-id <id> --access-token <token> [--slug <slug>] [--waba-id <id>] [--mode shared|byo] [--currency PYG|BRL|USD] [--locale es-PY|pt-BR|en]');
    process.exit(1);
  }
  if (!['shared', 'byo'].includes(mode)) {
    console.error(`❌ --mode inválido: ${mode} (use "shared" ou "byo")`);
    process.exit(1);
  }

  const db = createClient(supabaseUrl, supabaseKey);

  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .insert({
      name,
      slug: slug || null,
      currency,
      locale,
      secondary_currency: secondaryCurrency || null,
      secondary_locale: secondaryLocale || null,
    })
    .select('id')
    .single();

  if (tenantError || !tenant) {
    console.error('❌ Falha ao criar tenant:', tenantError?.message);
    process.exit(1);
  }

  const { error: credError } = await db.from('tenant_meta_credentials').insert({
    tenant_id: tenant.id,
    phone_number_id: phoneNumberId,
    access_token: accessToken,
    waba_id: wabaId || null,
    mode,
  });

  if (credError) {
    console.error('❌ Tenant criado, mas falha ao gravar credenciais do WhatsApp:', credError.message);
    console.error(`   tenant_id já criado: ${tenant.id} — corrija e insira as credenciais manualmente, ou rode de novo (vai duplicar o tenant).`);
    process.exit(1);
  }

  console.log(`✅ Tenant "${name}" criado: ${tenant.id}`);
  console.log(`✅ Credenciais WhatsApp (phone_number_id ${phoneNumberId}, modo ${mode}) associadas.`);
  console.log(`\nPróximo passo: npm run create:operator -- --tenant ${tenant.id} --email <email> --password <senha> --name "<nome>" --role admin`);
}

main();
