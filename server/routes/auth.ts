import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AuthRouterDeps {
  jwtSecret: string;
  demoMode: boolean;
  supabase: SupabaseClient | null;
}

export function createAuthRouter({ jwtSecret, demoMode, supabase }: AuthRouterDeps): Router {
  const router = Router();

  // Config pública — o frontend usa isso pra saber se pode oferecer o login de
  // demonstração (senhas fixas) ou se precisa exigir credenciais reais.
  router.get('/api/public/config', (req, res) => {
    res.json({ demoMode });
  });

  // Cadastro fixo dos perfis de demonstração — espelha exatamente
  // src/data/mockTenants.ts (SAAS_DEMO_USERS) e as senhas de
  // src/components/LoginModal.tsx (USER_PASSWORDS). Precisa ficar em sincronia
  // manual com esses dois arquivos caso os perfis demo mudem.
  //
  // Antes desta correção, o endpoint confiava cegamente em id/tenantId/role
  // vindos do corpo da requisição — qualquer um podia POST
  // {"id":"x","tenantId":"y","role":"saas_admin"} e ganhar um JWT de admin,
  // sem senha nenhuma. Agora role/tenantId/email vêm SEMPRE do cadastro fixo
  // abaixo, nunca do que o cliente mandou, e a senha é obrigatória.
  //
  // usr_carlos/usr_fernanda (tenant_001/tenant_002) removidos junto com as
  // empresas fictícias de demonstração do template original
  // (src/data/mockTenants.ts) — nunca foram clientes reais. usr_ricardo
  // (SaaS Master) reapontado pro único tenant real (tenant_004, Monique).
  const DEMO_USERS: Record<string, { passwords: string[]; tenantId: string; role: string; email: string }> = {
    usr_monique: { passwords: ['monique2026', 'admin123', '123456'], tenantId: 'tenant_004', role: 'admin', email: 'monique@pestanaspormonique.com' },
    usr_ricardo: { passwords: ['master2026#', 'adminMaster123'], tenantId: 'tenant_004', role: 'saas_admin', email: 'ricardo.master@saasplatform.com' },
  };

  // Emite um JWT válido pra um perfil de demonstração — só funciona com
  // DEMO_MODE=true. Valida a senha contra o cadastro fixo acima (nunca
  // confia em role/tenantId/email vindos do cliente).
  router.post('/api/auth/demo-token', (req, res) => {
    if (!demoMode) {
      return res.status(403).json({ error: 'Login de demonstração desabilitado (DEMO_MODE=false).' });
    }
    const { id, password } = req.body || {};
    const user = DEMO_USERS[id];
    if (!user || typeof password !== 'string' || !user.passwords.includes(password)) {
      // Mensagem genérica de propósito — não revela se o id existe ou só a senha está errada.
      return res.status(401).json({ error: 'Credenciais de demonstração inválidas.' });
    }
    const token = jwt.sign({ id, tenantId: user.tenantId, role: user.role, email: user.email, demo: true }, jwtSecret, { expiresIn: '24h' });
    res.json({ token });
  });

  // Rota de Login de Operadores e Administradores com verificação de senha
  //
  // Busca só por e-mail (case-insensitive) — NUNCA filtra por tenant_id vindo
  // do cliente. Antes desta correção, o frontend mandava o tenantId de mock
  // do card de preset demo selecionado (ex: "tenant_004", de
  // src/data/mockTenants.ts), que nunca bate com o tenant_id real (UUID) de
  // nenhum operador de verdade no Supabase — todo login real falhava com
  // "E-mail ou senha incorretos" mesmo com a senha certa, porque a query
  // .eq('tenant_id', 'tenant_004') nunca encontrava a linha. O tenant certo
  // é sempre derivado do próprio registro do operador encontrado, nunca
  // adivinhado a priori por quem está logando.
  router.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
      if (!password || password.trim() === '') {
        throw new Error('A senha é obrigatória.');
      }
      if (!email || String(email).trim() === '') {
        throw new Error('O e-mail é obrigatório.');
      }

      if (!supabase) {
        throw new Error('Supabase não está configurado. Configure SUPABASE_URL e SUPABASE_KEY no ambiente.');
      }

      const { data, error } = await supabase
        .from('operators')
        .select('*')
        .ilike('email', String(email).trim())
        .maybeSingle();

      const operator = data as any;

      // Mensagem genérica de propósito — "usuário não encontrado" vs "senha
      // incorreta" permite enumerar quais e-mails/tenants existem no sistema.
      const genericError = 'E-mail ou senha incorretos.';
      if (error || !operator) throw new Error(genericError);

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) throw new Error(genericError);

      const token = jwt.sign(
        { id: operator.id, tenantId: operator.tenant_id, role: operator.role },
        jwtSecret,
        { expiresIn: '24h' }
      );

      res.json({ token, operator: { name: operator.name, email: operator.email, role: operator.role, tenantId: operator.tenant_id } });
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });

  return router;
}
